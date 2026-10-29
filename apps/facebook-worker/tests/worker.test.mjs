import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryJobStore } from '../src/job-store.mjs';
import { JobRunner } from '../src/job-runner.mjs';
import { createWorkerServer } from '../src/server.mjs';

const config = {
  apiKey: 'test-key',
  automationEnabled: true,
  mock: true,
  pollIntervalMs: 10,
  jobTimeoutSeconds: 10,
};

test('idempotency key returns exactly one job', async () => {
  const store = new MemoryJobStore();
  const input = {
    idempotencyKey: 'facebook-group:post:integration',
    type: 'facebook-group-publish',
    profile: 'default',
    payload: { groupUrl: 'https://www.facebook.com/groups/mock', message: 'x' },
  };
  const first = await store.createOrGet(input);
  const second = await store.createOrGet(input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.job.id, second.job.id);
});

test('profile lock prevents concurrent mutation', async () => {
  const store = new MemoryJobStore();
  const first = await store.acquireProfileLock('default', 10);
  const second = await store.acquireProfileLock('default', 10);
  assert.ok(first);
  assert.equal(second, null);
  await store.releaseProfileLock('default', first);
  assert.ok(await store.acquireProfileLock('default', 10));
});

test('mock runner completes group and marketplace jobs', async () => {
  const store = new MemoryJobStore();
  const runner = new JobRunner(config, store, {});
  const group = await store.createOrGet({
    idempotencyKey: 'group-1',
    type: 'facebook-group-publish',
    profile: 'default',
    payload: { groupUrl: 'https://www.facebook.com/groups/mock', message: 'hello' },
  });
  const market = await store.createOrGet({
    idempotencyKey: 'market-1',
    type: 'facebook-marketplace-publish',
    profile: 'default',
    payload: { title: 'item', price: '1', category: 'Other', media: [{ type: 'image', url: 'https://example.com/a.jpg' }] },
  });
  await runner.runOnce();
  await runner.runOnce();
  assert.equal((await store.get(group.job.id)).status, 'SUCCESS');
  assert.match((await store.get(group.job.id)).result.releaseUrl, /groups\/mock/);
  assert.equal((await store.get(market.job.id)).status, 'SUCCESS');
  assert.match((await store.get(market.job.id)).result.releaseUrl, /marketplace\/item/);
});

test('HTTP API protects worker routes and accepts idempotent jobs', async () => {
  const store = new MemoryJobStore();
  const browserManager = {
    profileStatus: async (profile) => ({
      profile,
      exists: true,
      loggedIn: true,
      checkpoint: false,
      captcha: false,
      mock: true,
    }),
  };
  const server = createWorkerServer({ config, store, browserManager });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = 'http://127.0.0.1:' + address.port;

  try {
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);

    const unauthorized = await fetch(base + '/v1/jobs/nope');
    assert.equal(unauthorized.status, 401);

    const payload = {
      idempotencyKey: 'api-1',
      type: 'facebook-group-publish',
      profile: 'default',
      payload: { groupUrl: 'https://www.facebook.com/groups/mock', message: 'hello' },
    };
    const first = await fetch(base + '/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 202);
    const firstBody = await first.json();

    const second = await fetch(base + '/v1/jobs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(firstBody.jobId, secondBody.jobId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test('stale recovery retries pre-mutation jobs but never repeats PUBLISH_STARTED', async () => {
  const store = new MemoryJobStore();
  const first = await store.createOrGet({
    idempotencyKey: 'stale-running',
    type: 'facebook-group-publish',
    profile: 'default',
    payload: {},
  });
  await store.claimNext();
  store.jobs.set(first.job.id, {
    ...first.job,
    status: 'RUNNING',
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const second = await store.createOrGet({
    idempotencyKey: 'stale-publish-started',
    type: 'facebook-group-publish',
    profile: 'default',
    payload: {},
  });
  await store.claimNext();
  store.jobs.set(second.job.id, {
    ...second.job,
    status: 'PUBLISH_STARTED',
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  });

  await store.recoverStaleJobs(1);

  assert.equal((await store.get(first.job.id)).status, 'QUEUED');
  assert.ok(store.queue.includes(first.job.id));

  const unknown = await store.get(second.job.id);
  assert.equal(unknown.status, 'UNKNOWN_OUTCOME');
  assert.equal(unknown.error.code, 'UNKNOWN_OUTCOME');
  assert.equal(store.queue.includes(second.job.id), false);
});
