import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { detectSession } from './facebook.mjs';

const safeProfile = (profile) => {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(profile || '')) {
    throw new Error('Invalid browser profile name');
  }
  return profile;
};

export class BrowserManager {
  constructor(config) {
    this.config = config;
  }

  profilePath(profile) {
    return path.join(this.config.profileRoot, safeProfile(profile));
  }

  async withPage(profile, fn, options = {}) {
    const dir = this.profilePath(profile);
    await mkdir(dir, { recursive: true });
    const context = await chromium.launchPersistentContext(dir, {
      headless: options.headless ?? this.config.headless,
      viewport: { width: 1440, height: 1000 },
      locale: options.locale || 'en-US',
    });
    try {
      const pages = context.pages();
      const page = pages[0] || (await context.newPage());
      return await fn(page, context);
    } finally {
      await context.close();
    }
  }

  async profileStatus(profile) {
    if (this.config.mock) {
      return {
        profile,
        exists: true,
        loggedIn: true,
        checkpoint: false,
        captcha: false,
        mock: true,
      };
    }

    return this.withPage(profile, async (page) => {
      await page.goto('https://www.facebook.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      const session = await detectSession(page);
      return { profile, exists: true, ...session };
    });
  }
}
