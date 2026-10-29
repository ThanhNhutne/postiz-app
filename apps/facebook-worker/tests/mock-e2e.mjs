import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3101;
const BASE = 'http://127.0.0.1:' + PORT;
const API_KEY = 'mock-e2e-key';

const authHeaders = {
  authorization: 'Bearer ' + API_KEY,
  'content-type': 'application/json',
};

async function waitForHealth(timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await fetch(BASE + '/health');
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('facebook-worker did not become healthy');
}

async function submit(body) {
  const response = await fetch(BASE + '/v1/jobs', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, 'job submit failed: ' + response.status);
  return response.json();
}

async function poll(jobId, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const response = await fetch(BASE + '/v1/jobs/' + jobId, {
      headers: authHeaders,
    });
    assert.equal(response.status, 200);
    const job = await response.json();
    if (job.status === 'SUCCESS') return job;
    if (
      ['FAILED', 'UNKNOWN_OUTCOME', 'NEEDS_LOGIN', 'CHECKPOINT', 'CAPTCHA'].includes(
        job.status
      )
    ) {
      throw new Error('worker job ended in ' + job.status);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('worker job did not complete');
}

test('real Redis + HTTP mock E2E covers Group and Marketplace', async () => {
  const child = spawn(process.execPath, ['src/index.mjs'], {
    cwd: new URL('../', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      WORKER_API_KEY: API_KEY,
      REDIS_URL: 'redis://127.0.0.1:6379',
      FACEBOOK_AUTOMATION_ENABLED: 'true',
      FACEBOOK_WORKER_MOCK: 'true',
      FACEBOOK_HEADLESS: 'true',
      FACEBOOK_QUEUE_POLL_MS: '25',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString();
  });

  try {
    await waitForHealth();

    const profile = await fetch(BASE + '/v1/profiles/default/status', {
      headers: authHeaders,
    });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).loggedIn, true);

    const groupValidation = await fetch(BASE + '/v1/groups/validate', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        profile: 'default',
        groupUrl: 'https://www.facebook.com/groups/mock',
      }),
    });
    assert.equal(groupValidation.status, 200);
    assert.equal((await groupValidation.json()).valid, true);

    const groupInput = {
      idempotencyKey: 'e2e-group-one',
      type: 'facebook-group-publish',
      profile: 'default',
      payload: {
        groupUrl: 'https://www.facebook.com/groups/mock',
        message: 'mock e2e',
        media: [],
      },
    };
    const groupSubmit = await submit(groupInput);
    const duplicateSubmit = await submit(groupInput);
    assert.equal(groupSubmit.jobId, duplicateSubmit.jobId);
    const groupJob = await poll(groupSubmit.jobId);
    assert.match(groupJob.result.releaseUrl, /groups\/mock\/posts/);

    const marketplaceSubmit = await submit({
      idempotencyKey: 'e2e-marketplace-one',
      type: 'facebook-marketplace-publish',
      profile: 'default',
      payload: {
        title: 'Mock listing',
        price: '100',
        category: 'Other',
        description: 'mock',
        media: [{ type: 'image', url: 'https://example.com/mock.jpg' }],
      },
    });
    const marketplaceJob = await poll(marketplaceSubmit.jobId);
    assert.match(marketplaceJob.result.releaseUrl, /marketplace\/item/);
  } catch (error) {
    throw new Error((error?.message || error) + '\nWorker logs:\n' + logs);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
});
