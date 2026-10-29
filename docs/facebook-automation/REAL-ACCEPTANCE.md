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

The first login must run where Chromium can be viewed/interacted with.

Worker command:

```bash
npm --prefix apps/facebook-worker install
FACEBOOK_PROFILE_ROOT=./facebook-worker-data/browser-profiles \
npm --prefix apps/facebook-worker run browser:login -- --profile default
```

Complete Facebook login, 2FA and any checkpoint manually. The CLI prints:

`PROFILE_READY default`

On a headless VPS, create the profile on a trusted GUI machine and transfer the profile directory securely to the worker's persistent `/data/browser-profiles/default` volume, or provide a trusted GUI/noVNC session for the worker. Do not send the profile through Git or public file sharing.

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
