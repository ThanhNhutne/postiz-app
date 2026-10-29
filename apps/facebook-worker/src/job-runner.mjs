import {
  FacebookAutomationError,
  publishGroup,
  publishMarketplace,
} from './facebook.mjs';

const terminalStatusFor = (code) => {
  if (code === 'SESSION_EXPIRED' || code === 'LOGIN_REQUIRED') return 'NEEDS_LOGIN';
  if (code === 'CHECKPOINT_REQUIRED') return 'CHECKPOINT';
  if (code === 'CAPTCHA_REQUIRED') return 'CAPTCHA';
  if (code === 'ACCOUNT_RESTRICTED') return 'ACCOUNT_RESTRICTED';
  if (code === 'UNKNOWN_OUTCOME') return 'UNKNOWN_OUTCOME';
  return 'FAILED';
};

export class JobRunner {
  constructor(config, store, browserManager) {
    this.config = config;
    this.store = store;
    this.browserManager = browserManager;
    this.timer = null;
    this.running = false;
    this.lastMutationAt = 0;
  }

  log(job, step, status, extra = {}) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        service: 'facebook-worker',
        version: '0.1.0',
        jobId: job?.id,
        type: job?.type,
        profile: job?.profile,
        step,
        status,
        ...extra,
      })
    );
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        console.error(JSON.stringify({
          service: 'facebook-worker',
          level: 'error',
          message: error?.message || String(error),
        }));
      });
    }, this.config.pollIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    if (this.running) return false;
    this.running = true;
    let lockToken;
    let job;
    try {
      job = await this.store.claimNext();
      if (!job) return false;
      if (job.status !== 'QUEUED') return false;
      this.log(job, 'job_received', 'ok');

      lockToken = await this.store.acquireProfileLock(
        job.profile,
        this.config.jobTimeoutSeconds + 30
      );
      if (!lockToken) {
        await this.store.enqueue(job.id);
        return false;
      }

      job = await this.store.save({
        ...job,
        status: 'RUNNING',
        startedAt: job.startedAt || new Date().toISOString(),
      });
      this.log(job, 'job_running', 'ok');

      if (!this.config.automationEnabled) {
        await this.fail(job, 'AUTOMATION_DISABLED', 'Facebook automation is disabled');
        return true;
      }

      if (this.config.mock) {
        const group = job.type === 'facebook-group-publish';
        await this.store.save({
          ...job,
          status: 'SUCCESS',
          finishedAt: new Date().toISOString(),
          result: {
            remoteId: job.id,
            releaseUrl: group
              ? 'https://www.facebook.com/groups/mock/posts/' + job.id
              : 'https://www.facebook.com/marketplace/item/' + job.id,
          },
        });
        return true;
      }

      if (!this.config.mock && this.config.minJobGapSeconds > 0) {
        const waitMs =
          this.lastMutationAt +
          this.config.minJobGapSeconds * 1000 -
          Date.now();
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }

      const result = await this.browserManager.withPage(job.profile, async (page) => {
        const markPublishStarted = async () => {
          this.lastMutationAt = Date.now();
          job = await this.store.save({ ...job, status: 'PUBLISH_STARTED' });
          this.log(job, 'publish_started', 'ok', {
            selectorVersion: this.config.selectorVersion,
          });
        };
        const context = {
          config: this.config,
          jobId: job.id,
          markPublishStarted,
        };
        if (job.type === 'facebook-group-publish') {
          return publishGroup(page, job.payload, context);
        }
        if (job.type === 'facebook-marketplace-publish') {
          return publishMarketplace(page, job.payload, context);
        }
        throw new FacebookAutomationError('UNKNOWN_ERROR', 'Unsupported worker job type');
      });

      const completedJob = await this.store.save({
        ...job,
        status: result.status,
        finishedAt: new Date().toISOString(),
        result: {
          remoteId: result.remoteId,
          releaseUrl: result.releaseUrl,
        },
      });
      this.log(completedJob, 'job_completed', 'ok', {
        releaseUrl: result.releaseUrl || '',
      });
      return true;
    } catch (error) {
      if (job) {
        const current = (await this.store.get(job.id)) || job;
        const unknown =
          current.status === 'PUBLISH_STARTED' &&
          error?.code !== 'PENDING_APPROVAL';
        const code = unknown ? 'UNKNOWN_OUTCOME' : error?.code || 'UNKNOWN_ERROR';

        const safeRetry =
          current.status === 'RUNNING' &&
          ['NETWORK_ERROR', 'PAGE_LOAD_FAILED', 'TIMEOUT'].includes(code) &&
          Number(current.attempts || 0) < 2;

        if (safeRetry) {
          const retryJob = await this.store.save({
            ...current,
            status: 'QUEUED',
            attempts: Number(current.attempts || 0) + 1,
            error: {
              code,
              message:
                error?.message ||
                'Temporary worker error; retrying safely before publish',
            },
          });
          await this.store.enqueue(retryJob.id);
          this.log(retryJob, 'job_retry_scheduled', 'retry', {
            code,
            attempt: retryJob.attempts,
          });
          return true;
        }

        const failedJob = await this.store.save({
          ...current,
          status: unknown ? 'UNKNOWN_OUTCOME' : terminalStatusFor(code),
          finishedAt: new Date().toISOString(),
          error: {
            code,
            message: unknown
              ? 'Publish may have reached Facebook; automatic retry is disabled to avoid duplicates'
              : error?.message || 'Unknown worker error',
            screenshotPath: error?.details?.screenshotPath,
            currentUrl: error?.details?.currentUrl,
            selectorVersion: this.config.selectorVersion,
          },
        });
        this.log(failedJob, 'job_failed', 'error', { code });
      }
      return true;
    } finally {
      if (job && lockToken) {
        await this.store.releaseProfileLock(job.profile, lockToken).catch(() => {});
      }
      this.running = false;
    }
  }

  async fail(job, code, message) {
    const failedJob = await this.store.save({
      ...job,
      status: 'FAILED',
      finishedAt: new Date().toISOString(),
      error: { code, message, selectorVersion: this.config.selectorVersion },
    });
    this.log(failedJob, 'job_failed', 'error', { code });
  }
}
