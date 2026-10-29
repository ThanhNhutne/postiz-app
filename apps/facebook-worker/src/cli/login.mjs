import { loadConfig } from '../config.mjs';
import { BrowserManager } from '../browser.mjs';
import { detectSession } from '../facebook.mjs';

const args = process.argv.slice(2);
const profileIndex = args.indexOf('--profile');
const profile = profileIndex >= 0 ? args[profileIndex + 1] : 'default';
if (!profile) throw new Error('Missing --profile value');

const config = { ...loadConfig(), headless: false, mock: false };
const manager = new BrowserManager(config);

await manager.withPage(
  profile,
  async (page) => {
    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    console.log('Log in to Facebook in the opened browser. Password and 2FA are never read by Postiz.');

    while (true) {
      const status = await detectSession(page);
      if (status.loggedIn) {
        console.log('PROFILE_READY ' + profile);
        return;
      }
      if (status.checkpoint) {
        console.log('CHECKPOINT_REQUIRED: complete the Facebook checkpoint manually.');
      } else if (status.captcha) {
        console.log('CAPTCHA_REQUIRED: complete CAPTCHA manually.');
      }
      await page.waitForTimeout(2000);
    }
  },
  { headless: false }
);
