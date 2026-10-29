# Security Notes

## Secrets

Required secret:

`FACEBOOK_WORKER_API_KEY`

Postiz uses it as `FACEBOOK_WORKER_API_KEY`; the worker receives the same value as `WORKER_API_KEY`.

Do not commit the value. Use a long random secret.

## Facebook credentials

The worker does **not** accept or store Facebook username, password or a 2FA secret.

Authentication is kept in a persistent Chromium profile under:

`/data/browser-profiles/<profile>`

Treat this directory as a credential. Restrict filesystem access, encrypt backups and never commit/copy it to an untrusted system.

## Worker exposure

Production Compose uses `expose: 3001`, not a host-published port. Only containers on the Postiz Docker network should reach it.

All endpoints except `GET /health` require:

`Authorization: Bearer <WORKER_API_KEY>`

## Browser security behavior

The implementation intentionally does not include:

- CAPTCHA bypass
- checkpoint bypass
- 2FA interception
- fingerprint spoofing
- stealth / anti-detection plugins
- proxy rotation to evade limits

CAPTCHA/checkpoint/session expiration are terminal operational states requiring the account owner.

## Media downloads

Worker media downloads accept HTTP/HTTPS only, reject loopback/private/link-local targets, resolve DNS before fetching, enforce a configured byte limit and use timeouts.

## Kill switch

Live browser mutations are disabled unless both Postiz and the worker receive:

`FACEBOOK_AUTOMATION_ENABLED=true`

Default is `false`.
