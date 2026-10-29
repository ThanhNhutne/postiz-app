# Mock E2E

Mock mode exists to validate the integration without a Facebook session.

## Configuration

```env
FACEBOOK_WORKER_API_KEY=<same-secret-on-postiz-and-worker>
FACEBOOK_AUTOMATION_ENABLED=true
FACEBOOK_WORKER_MOCK=true
FACEBOOK_HEADLESS=true
```

For local Postiz running outside Docker, use:

```env
FACEBOOK_WORKER_URL=http://localhost:3001
```

For Postiz running in the production Compose network:

```env
FACEBOOK_WORKER_URL=http://facebook-worker:3001
```

## Expected Group flow

```text
Postiz schedule
 -> FacebookGroupProvider.postPending()
 -> POST /v1/jobs
 -> Redis QUEUED
 -> Worker RUNNING
 -> deterministic SUCCESS
 -> Postiz checkPostStatus()
 -> PUBLISHED
```

Mock release URL:

`https://www.facebook.com/groups/mock/posts/<workerJobId>`

## Expected Marketplace flow

Mock release URL:

`https://www.facebook.com/marketplace/item/<workerJobId>`

## Automated worker coverage

`apps/facebook-worker/tests/worker.test.mjs` verifies:

- idempotency key returns one worker job
- per-profile mutation lock
- Group mock publish
- Marketplace mock publish
- public health endpoint
- protected worker endpoints
- duplicate API submit returns the existing job

The dedicated `Facebook Worker` GitHub Action runs syntax checking and these tests on every worker change.

Root Postiz CI validates provider/DTO/frontend TypeScript compilation.
