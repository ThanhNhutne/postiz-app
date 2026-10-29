# Real Facebook Acceptance

Do this only after automated CI is green.

## 1. Configure secrets but keep automation disabled

Set a strong shared value:

```env
FACEBOOK_WORKER_API_KEY=<long-random-secret>
FACEBOOK_AUTOMATION_ENABLED=false
FACEBOOK_WORKER_MOCK=false
FACEBOOK_HEADLESS=true
```

Build/start the custom fork and worker.

## 2. Create the Facebook browser profile

The preferred production login flow is the optional noVNC login container. It shares the same persistent browser-profile volume as the worker, but its web UI is bound to localhost only.

First stop the normal worker so two Chromium processes never open the same profile:

```bash
docker compose stop facebook-worker
docker compose --profile facebook-login up --build facebook-worker-login
```

If Docker runs on the same machine, open:

`http://127.0.0.1:6080/vnc.html`

If Docker runs on a remote VPS, create an SSH tunnel from your workstation:

```bash
ssh -L 6080:127.0.0.1:6080 <user>@<postiz-server>
```

Then open the same local URL in your browser.

Complete Facebook login, 2FA and any security checkpoint manually inside Chromium. The login process prints:

`PROFILE_READY default`

Stop the login container, then restart the normal worker:

```bash
docker compose --profile facebook-login stop facebook-worker-login
docker compose up -d facebook-worker
```

The noVNC port is intentionally never bound to a public interface. Do not reverse-proxy or expose port 6080 to the Internet.

For a non-Docker development machine with a graphical desktop, the direct CLI remains available:

```bash
npm --prefix apps/facebook-worker install
FACEBOOK_PROFILE_ROOT=./facebook-worker-data/browser-profiles \
npm --prefix apps/facebook-worker run browser:login -- --profile default
```

## 3. Enable live mutations

Only after the profile is valid:

```env
FACEBOOK_AUTOMATION_ENABLED=true
FACEBOOK_WORKER_MOCK=false
```

Restart Postiz/worker so both receive the flag.

## 4. Group test

Use a harmless group that the account owns/administers or is permitted to post in.

In Postiz:

- Add Channel -> Facebook Group
- Browser profile: `default`
- Group URL: test group URL
- Create content: `POSTIZ FACEBOOK GROUP ACCEPTANCE TEST`
- Attach one non-sensitive image
- Post now

PASS:

- Postiz reaches published/success
- exactly one Facebook post exists
- no duplicate after waiting/reloading
- release URL resolves, or a documented group approval state is shown

## 5. Marketplace test

- Add Channel -> Facebook Marketplace
- Browser profile: `default`
- Create a harmless test listing permitted by Facebook
- Fill title, price, category and description
- attach at least one image
- Post now

PASS:

- exactly one listing exists
- Postiz reaches success
- listing URL is stored

If the account has no Marketplace access, `MARKETPLACE_NOT_AVAILABLE` or `MARKETPLACE_RESTRICTED` is the expected behavior.

## 6. Failure checks

If Facebook shows CAPTCHA/checkpoint, automation must stop. Complete it manually and reconnect/retry only after confirming whether the previous post/listing exists.
