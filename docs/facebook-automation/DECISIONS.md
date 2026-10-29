# Architecture Decision Log

## ADR-001 — Browser worker instead of Meta Groups API

Facebook Group publishing for this use case is not implemented with Graph API. Group and Marketplace publishing are executed against Facebook Web UI by a separate Playwright worker.

## ADR-002 — One Facebook Group per Postiz channel

Each group connection is stored as an independent Postiz Integration. Selecting multiple groups uses Postiz's existing multi-channel scheduling rather than a custom loop inside one provider.

Benefits: independent status, retry, release URL and failure reporting.

## ADR-003 — Worker is in the repository but outside pnpm workspace

`apps/facebook-worker` lives in this repository for versioned deployment, but is excluded from `pnpm-workspace.yaml`.

Reason: Playwright is a large, worker-only runtime dependency. Isolating it avoids modifying or destabilizing the Postiz root lockfile. Worker CI installs its exact npm dependencies independently.

## ADR-004 — Redis job state and profile locks

Worker job state, idempotency keys and per-profile mutation locks are stored in Redis. A single Facebook profile never executes two publishing mutations concurrently.

## ADR-005 — Unknown outcome is terminal

Immediately before the final Facebook mutation click, the job becomes `PUBLISH_STARTED`. If the worker loses certainty after that point, it records `UNKNOWN_OUTCOME` and does not automatically publish again.

This favors a manual check over a duplicate post/listing.

## ADR-006 — Mock mode is first-class

`FACEBOOK_WORKER_MOCK=true` exercises API, queue, locking, Postiz pending-job behavior and deterministic result URLs without a Facebook account. Live Facebook login is only a final acceptance step.
