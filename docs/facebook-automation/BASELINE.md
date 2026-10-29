# Facebook Automation Baseline

- Repository: `ThanhNhutne/postiz-app`
- Origin main at implementation start: `6f1078011b39612838a1ce271dac5535ef9a57e5`
- Upstream repository: `gitroomhq/postiz-app`
- Upstream main observed at implementation start: `64f00fd6d0e9dfd55d202ff83983e7576e08bc2e`
- Feature branch: `feat/facebook-group-marketplace-worker`
- Pull request: #1
- Root CI runtime: Node 22.12.0 / pnpm 10
- Worker runtime: Node 22+, Playwright 1.64.1

## Existing Postiz capability reused

The fork already contains the durable pending-provider contract:

- `postPending()`
- `checkPostStatus()`
- `finalizePost()`

and `postWorkflowV112` resolves pending publishes without re-running an accepted mutation. No Temporal core rewrite or database schema migration is required for this feature.

## Baseline constraints

The implementation session writes through the GitHub connector. The local execution sandbox did not provide a usable GitHub clone/network path, so repository build/test validation is performed by GitHub Actions on PR #1.

An early feature commit entered the pnpm workspace and correctly exposed a frozen-lockfile failure. The worker is now explicitly excluded from the Postiz pnpm workspace and has an independent npm/CI lifecycle.
