import { loadConfig, assertConfig } from './config.mjs';
import { RedisJobStore } from './job-store.mjs';
import { BrowserManager } from './browser.mjs';
import { JobRunner } from './job-runner.mjs';
import { createWorkerServer } from './server.mjs';

const config = loadConfig();
assertConfig(config);

const store = new RedisJobStore(config.redisUrl, config.jobTtlSeconds);
await store.connect();

const browserManager = new BrowserManager(config);
const runner = new JobRunner(config, store, browserManager);
const server = createWorkerServer({ config, store, browserManager });

server.listen(config.port, '0.0.0.0', () => {
  console.log(JSON.stringify({
    service: 'facebook-worker',
    version: '0.1.0',
    status: 'started',
    port: config.port,
    automationEnabled: config.automationEnabled,
    mock: config.mock,
  }));
});

runner.start();

const shutdown = async () => {
  runner.stop();
  await new Promise((resolve) => server.close(resolve));
  await store.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
