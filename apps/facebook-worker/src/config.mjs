const numberValue = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolValue = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

export function loadConfig(env = process.env) {
  return {
    port: numberValue(env.PORT, 3001),
    apiKey: env.WORKER_API_KEY || '',
    redisUrl: env.REDIS_URL || 'redis://127.0.0.1:6379',
    profileRoot: env.FACEBOOK_PROFILE_ROOT || '/data/browser-profiles',
    screenshotRoot: env.FACEBOOK_SCREENSHOT_ROOT || '/data/screenshots',
    headless: boolValue(env.FACEBOOK_HEADLESS, true),
    selectorVersion: env.FACEBOOK_SELECTOR_VERSION || '1',
    automationEnabled: boolValue(env.FACEBOOK_AUTOMATION_ENABLED, false),
    mock: boolValue(env.FACEBOOK_WORKER_MOCK, false),
    jobTtlSeconds: numberValue(env.FACEBOOK_JOB_TTL_SECONDS, 604800),
    jobTimeoutSeconds: numberValue(env.FACEBOOK_JOB_TIMEOUT_SECONDS, 180),
    pollIntervalMs: numberValue(env.FACEBOOK_QUEUE_POLL_MS, 750),
    minJobGapSeconds: numberValue(env.FACEBOOK_MIN_JOB_GAP_SECONDS, 30),
    maxMediaBytes: numberValue(env.FACEBOOK_MAX_MEDIA_BYTES, 25 * 1024 * 1024),
  };
}

export function assertConfig(config) {
  if (!config.apiKey) {
    throw new Error('WORKER_API_KEY is required');
  }
}
