import http from 'node:http';
import { URL } from 'node:url';
import { validateGroup, validateMarketplace } from './facebook.mjs';

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function authorized(req, config) {
  return req.headers.authorization === 'Bearer ' + config.apiKey;
}

function validSubmit(body) {
  if (!body?.idempotencyKey || !body?.profile || !body?.type) return false;
  if (!['facebook-group-publish', 'facebook-marketplace-publish'].includes(body.type)) {
    return false;
  }
  return !!body.payload && typeof body.payload === 'object';
}

function errorBody(error) {
  return {
    error: true,
    code: error?.code || 'UNKNOWN_ERROR',
    message: error?.message || 'Unknown worker error',
  };
}

export function createWorkerServer({ config, store, browserManager }) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') {
        const redis = await store.ping();
        return json(res, redis ? 200 : 503, {
          ok: redis,
          service: 'facebook-worker',
          version: '0.1.0',
          redis: redis ? 'ready' : 'unavailable',
          browser: 'ready',
          automationEnabled: config.automationEnabled,
          mock: config.mock,
        });
      }

      if (!authorized(req, config)) {
        return json(res, 401, { error: true, code: 'UNAUTHORIZED' });
      }

      const profileMatch = url.pathname.match(/^\/v1\/profiles\/([^/]+)\/status$/);
      if (req.method === 'GET' && profileMatch) {
        const status = await browserManager.profileStatus(
          decodeURIComponent(profileMatch[1])
        );
        return json(res, 200, status);
      }

      if (req.method === 'POST' && url.pathname === '/v1/groups/validate') {
        const body = await readJson(req);
        if (!body.profile || !body.groupUrl) {
          return json(res, 400, {
            error: true,
            code: 'INVALID_REQUEST',
            message: 'profile and groupUrl are required',
          });
        }
        if (config.mock) {
          return json(res, 200, {
            valid: true,
            groupId: 'mock',
            name: 'Mock Facebook Group',
            canPost: true,
          });
        }
        const result = await browserManager.withPage(body.profile, (page) =>
          validateGroup(page, body.groupUrl)
        );
        return json(res, 200, result);
      }

      if (req.method === 'POST' && url.pathname === '/v1/marketplace/validate') {
        const body = await readJson(req);
        if (!body.profile) {
          return json(res, 400, {
            error: true,
            code: 'INVALID_REQUEST',
            message: 'profile is required',
          });
        }
        if (config.mock) return json(res, 200, { available: true, mock: true });
        const result = await browserManager.withPage(body.profile, (page) =>
          validateMarketplace(page)
        );
        return json(res, 200, result);
      }

      if (req.method === 'POST' && url.pathname === '/v1/jobs') {
        const body = await readJson(req);
        if (!validSubmit(body)) {
          return json(res, 400, {
            error: true,
            code: 'INVALID_REQUEST',
            message: 'Invalid worker job payload',
          });
        }
        if (!config.automationEnabled) {
          return json(res, 503, {
            error: true,
            code: 'AUTOMATION_DISABLED',
            message: 'Facebook automation is disabled',
          });
        }
        const { job, created } = await store.createOrGet(body);
        return json(res, created ? 202 : 200, {
          jobId: job.id,
          status: job.status,
          created,
        });
      }

      const jobMatch = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/);
      if (req.method === 'GET' && jobMatch) {
        const job = await store.get(decodeURIComponent(jobMatch[1]));
        if (!job) {
          return json(res, 404, { error: true, code: 'JOB_NOT_FOUND' });
        }
        return json(res, 200, job);
      }

      return json(res, 404, { error: true, code: 'NOT_FOUND' });
    } catch (error) {
      const code = error?.code || 'UNKNOWN_ERROR';
      const status =
        code === 'SESSION_EXPIRED' ||
        code === 'CHECKPOINT_REQUIRED' ||
        code === 'CAPTCHA_REQUIRED'
          ? 409
          : 400;
      return json(res, status, errorBody(error));
    }
  });
}
