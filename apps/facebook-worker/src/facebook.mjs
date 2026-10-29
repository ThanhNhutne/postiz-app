import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';

function classifyAutomationError(error) {
  if (error instanceof FacebookAutomationError) return error.code;
  const message = String(error?.message || '');
  if (error?.name === 'TimeoutError' || /timed? ?out|timeout/i.test(message)) {
    return 'TIMEOUT';
  }
  if (/net::ERR_|ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN/i.test(message)) {
    return 'NETWORK_ERROR';
  }
  return 'UNKNOWN_ERROR';
}

export class FacebookAutomationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FacebookAutomationError';
    this.code = code;
    this.details = details;
  }
}

const RX = {
  createPost: /Create post|Tạo bài viết|Write something|Bạn viết gì đi/i,
  post: /^(Post|Đăng)$/i,
  photoVideo: /Photo\/video|Ảnh\/video/i,
  title: /Title|Tiêu đề/i,
  price: /Price|Giá/i,
  description: /Description|Mô tả/i,
  category: /Category|Danh mục/i,
  condition: /Condition|Tình trạng/i,
  location: /Location|Vị trí/i,
  next: /^(Next|Tiếp)$/i,
  publish: /^(Publish|Đăng)$/i,
};

export async function detectSession(page) {
  const url = page.url();
  const text = await page.locator('body').innerText().catch(() => '');
  const lower = text.toLowerCase();

  const checkpoint =
    url.includes('/checkpoint/') ||
    lower.includes('security check') ||
    lower.includes('kiểm tra bảo mật');
  const captcha =
    lower.includes('captcha') ||
    (await page.locator('iframe[src*="captcha"]').count().catch(() => 0)) > 0;
  const loggedOut =
    url.includes('/login') ||
    (await page.locator('input[name="email"]').count().catch(() => 0)) > 0;

  return {
    loggedIn: !checkpoint && !captcha && !loggedOut,
    checkpoint,
    captcha,
  };
}

function sessionError(session) {
  if (session.checkpoint) {
    return new FacebookAutomationError(
      'CHECKPOINT_REQUIRED',
      'Facebook requires a security checkpoint'
    );
  }
  if (session.captcha) {
    return new FacebookAutomationError(
      'CAPTCHA_REQUIRED',
      'Facebook requires CAPTCHA verification'
    );
  }
  if (!session.loggedIn) {
    return new FacebookAutomationError(
      'SESSION_EXPIRED',
      'Facebook login session is missing or expired'
    );
  }
  return null;
}

async function ensureSession(page) {
  const session = await detectSession(page);
  const error = sessionError(session);
  if (error) throw error;
}

function groupIdFromUrl(groupUrl) {
  try {
    const url = new URL(groupUrl);
    const match = url.pathname.match(/\/groups\/([^/]+)/i);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

async function bodyText(page) {
  return (await page.locator('body').innerText().catch(() => '')).slice(0, 80000);
}

async function firstVisible(locators) {
  for (const locator of locators) {
    try {
      if ((await locator.count()) > 0 && (await locator.first().isVisible())) {
        return locator.first();
      }
    } catch {}
  }
  return null;
}

async function screenshot(page, config, jobId, code) {
  try {
    await mkdir(config.screenshotRoot, { recursive: true });
    const safe = String(jobId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const target = path.join(config.screenshotRoot, safe + '_' + code + '.png');
    await page.screenshot({ path: target, fullPage: true });
    return target;
  } catch {
    return undefined;
  }
}

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return false;
  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) return isPrivateIpv4(address);
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd')
    );
  }
  return false;
}

async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new FacebookAutomationError('MEDIA_DOWNLOAD_FAILED', 'Invalid media URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new FacebookAutomationError(
      'MEDIA_DOWNLOAD_FAILED',
      'Media URL must use http or https'
    );
  }
  if (url.hostname === 'localhost') {
    throw new FacebookAutomationError(
      'MEDIA_DOWNLOAD_FAILED',
      'Private media host is not allowed'
    );
  }
  if (net.isIP(url.hostname) && isPrivateAddress(url.hostname)) {
    throw new FacebookAutomationError(
      'MEDIA_DOWNLOAD_FAILED',
      'Private media host is not allowed'
    );
  }
  try {
    const resolved = await dns.lookup(url.hostname, { all: true });
    if (resolved.some((item) => isPrivateAddress(item.address))) {
      throw new FacebookAutomationError(
        'MEDIA_DOWNLOAD_FAILED',
        'Private media host is not allowed'
      );
    }
  } catch (error) {
    if (error instanceof FacebookAutomationError) throw error;
    throw new FacebookAutomationError(
      'MEDIA_DOWNLOAD_FAILED',
      'Could not resolve media host'
    );
  }
  return url;
}

async function downloadMedia(media, config, jobId) {
  if (!media?.length) return { dir: null, files: [] };
  const dir = path.join(
    os.tmpdir(),
    'postiz-facebook-worker',
    String(jobId).replace(/[^a-zA-Z0-9._-]/g, '_')
  );
  await mkdir(dir, { recursive: true });
  const files = [];

  try {
    for (let i = 0; i < media.length; i += 1) {
      const item = media[i];
      const url = await assertPublicUrl(item.url);
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        throw new FacebookAutomationError(
          'MEDIA_DOWNLOAD_FAILED',
          'Could not download media: HTTP ' + response.status
        );
      }

      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > config.maxMediaBytes) {
        throw new FacebookAutomationError(
          'MEDIA_DOWNLOAD_FAILED',
          'Media file exceeds configured size limit'
        );
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > config.maxMediaBytes) {
        throw new FacebookAutomationError(
          'MEDIA_DOWNLOAD_FAILED',
          'Media file exceeds configured size limit'
        );
      }

      let ext = path.extname(url.pathname).slice(0, 10);
      if (!ext) ext = item.type === 'video' ? '.mp4' : '.jpg';
      const target = path.join(dir, String(i + 1) + ext);
      await writeFile(target, bytes);
      files.push(target);
    }
    return { dir, files };
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function cleanDownloaded(downloaded) {
  if (downloaded?.dir) {
    await rm(downloaded.dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function validateGroupPage(page, groupUrl) {
  if (!/^https:\/\/([^.]+\.)?facebook\.com\/groups\//i.test(groupUrl || '')) {
    throw new FacebookAutomationError(
      'GROUP_NOT_FOUND',
      'Group URL must be a facebook.com/groups URL'
    );
  }

  try {
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    throw new FacebookAutomationError(
      classifyAutomationError(error) === 'TIMEOUT'
        ? 'TIMEOUT'
        : 'PAGE_LOAD_FAILED',
      error?.message || 'Could not load the Facebook group'
    );
  }
  await ensureSession(page);
  const text = await bodyText(page);

  if (
    /This content isn't available|Nội dung này hiện không hiển thị/i.test(text)
  ) {
    throw new FacebookAutomationError('GROUP_NOT_FOUND', 'Facebook group was not found');
  }

  const createPost = await firstVisible([
    page.getByRole('button', { name: RX.createPost }),
    page.getByText(RX.createPost, { exact: false }),
  ]);

  const title =
    (await page.locator('h1').first().innerText().catch(() => '')) ||
    (await page.title()).replace(/\s*\|\s*Facebook.*$/i, '');

  const groupId = groupIdFromUrl(page.url()) || groupIdFromUrl(groupUrl);
  return {
    valid: true,
    groupId,
    name: title || groupId || 'Facebook Group',
    canPost: !!createPost,
  };
}

export async function validateGroup(page, groupUrl) {
  const result = await validateGroupPage(page, groupUrl);
  if (!result.canPost) {
    throw new FacebookAutomationError(
      'GROUP_POST_DISABLED',
      'The current Facebook account cannot create a post in this group'
    );
  }
  return result;
}

async function composerTextbox(page) {
  const dialog = page.getByRole('dialog').last();
  return firstVisible([
    dialog.getByRole('textbox'),
    dialog.locator('[contenteditable="true"][role="textbox"]'),
    page.locator('[contenteditable="true"][role="textbox"]'),
  ]);
}

export async function publishGroup(page, payload, context) {
  let downloaded;
  try {
    const group = await validateGroup(page, payload.groupUrl);
    const createPost = await firstVisible([
      page.getByRole('button', { name: RX.createPost }),
      page.getByText(RX.createPost, { exact: false }),
    ]);
    if (!createPost) {
      throw new FacebookAutomationError(
        'SELECTOR_BROKEN',
        'Could not find the Facebook group post composer'
      );
    }
    await createPost.click();
    const textbox = await composerTextbox(page);
    if (!textbox) {
      throw new FacebookAutomationError(
        'SELECTOR_BROKEN',
        'Could not find the Facebook group post text box'
      );
    }

    if (payload.message) {
      await textbox.click();
      await textbox.fill(payload.message).catch(async () => {
        await page.keyboard.insertText(payload.message);
      });
    }

    downloaded = await downloadMedia(payload.media || [], context.config, context.jobId);
    if (downloaded.files.length) {
      let input = page.locator('input[type="file"]').last();
      if ((await input.count()) === 0) {
        const addMedia = await firstVisible([
          page.getByText(RX.photoVideo, { exact: false }),
          page.getByRole('button', { name: RX.photoVideo }),
        ]);
        if (addMedia) await addMedia.click();
        input = page.locator('input[type="file"]').last();
      }
      if ((await input.count()) === 0) {
        throw new FacebookAutomationError(
          'MEDIA_UPLOAD_FAILED',
          'Could not find the Facebook media upload input'
        );
      }
      await input.setInputFiles(downloaded.files);
      await page.waitForTimeout(1200);
    }

    const dialog = page.getByRole('dialog').last();
    const postButton = await firstVisible([
      dialog.getByRole('button', { name: RX.post }),
      page.getByRole('button', { name: RX.post }),
    ]);
    if (!postButton) {
      throw new FacebookAutomationError(
        'SELECTOR_BROKEN',
        'Could not find the Facebook Post button'
      );
    }

    const beforeLinks = new Set(
      await page
        .locator('a[href*="/posts/"]')
        .evaluateAll((nodes) => nodes.map((node) => node.href).filter(Boolean))
        .catch(() => [])
    );

    await context.markPublishStarted();
    await postButton.click();

    let releaseUrl = '';
    let pendingApproval = false;
    let explicitSuccess = false;
    const deadline = Date.now() + 12_000;

    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      const text = await bodyText(page);
      pendingApproval =
        /pending approval|awaiting approval|đang chờ phê duyệt|chờ quản trị viên phê duyệt/i.test(
          text
        );
      explicitSuccess =
        /your post (?:is now )?published|your post was published|bài viết của bạn đã được đăng/i.test(
          text
        );

      const links = await page
        .locator('a[href*="/posts/"]')
        .evaluateAll((nodes) => nodes.map((node) => node.href).filter(Boolean))
        .catch(() => []);
      releaseUrl =
        links.find(
          (href) =>
            !beforeLinks.has(href) &&
            (!group.groupId || href.includes('/groups/' + group.groupId + '/'))
        ) || '';

      if (releaseUrl || pendingApproval || explicitSuccess) break;
    }

    if (pendingApproval) {
      return {
        status: 'PENDING_APPROVAL',
        remoteId: context.jobId,
        releaseUrl: releaseUrl || payload.groupUrl,
      };
    }

    if (!releaseUrl && !explicitSuccess) {
      throw new FacebookAutomationError(
        'UNKNOWN_OUTCOME',
        'Facebook accepted the Post click but the new group post could not be confirmed'
      );
    }

    const confirmedUrl = releaseUrl || payload.groupUrl;
    return {
      status: 'SUCCESS',
      remoteId:
        confirmedUrl.match(/\/posts\/([^/?]+)/)?.[1] || context.jobId,
      releaseUrl: confirmedUrl,
    };
  } catch (error) {
    const code = classifyAutomationError(error);
    const screenshotPath = await screenshot(
      page,
      context.config,
      context.jobId,
      code
    );
    if (error instanceof FacebookAutomationError) {
      error.details = {
        ...error.details,
        screenshotPath,
        currentUrl: page.url(),
      };
      throw error;
    }
    throw new FacebookAutomationError(
      'UNKNOWN_ERROR',
      error?.message || 'Unknown Facebook group publishing error',
      { screenshotPath, currentUrl: page.url() }
    );
  } finally {
    await cleanDownloaded(downloaded);
  }
}

export async function validateMarketplace(page) {
  try {
    await page.goto('https://www.facebook.com/marketplace/create/item', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  } catch (error) {
    throw new FacebookAutomationError(
      classifyAutomationError(error) === 'TIMEOUT'
        ? 'TIMEOUT'
        : 'PAGE_LOAD_FAILED',
      error?.message || 'Could not load Facebook Marketplace'
    );
  }
  await ensureSession(page);
  const text = await bodyText(page);
  if (
    /Marketplace isn't available|Marketplace is not available|Marketplace không khả dụng/i.test(
      text
    )
  ) {
    throw new FacebookAutomationError(
      'MARKETPLACE_NOT_AVAILABLE',
      'Facebook Marketplace is not available for this account'
    );
  }
  if (/restricted from Marketplace|không thể sử dụng Marketplace/i.test(text)) {
    throw new FacebookAutomationError(
      'MARKETPLACE_RESTRICTED',
      'This Facebook account is restricted from Marketplace'
    );
  }
  return { available: true };
}

async function fillField(page, regex, value) {
  if (value === undefined || value === null || value === '') return false;
  const field = await firstVisible([
    page.getByLabel(regex),
    page.getByRole('textbox', { name: regex }),
  ]);
  if (!field) return false;
  await field.fill(String(value));
  return true;
}

async function chooseOption(page, labelRegex, value) {
  if (!value) return true;
  const control = await firstVisible([
    page.getByLabel(labelRegex),
    page.getByRole('button', { name: labelRegex }),
    page.getByText(labelRegex, { exact: false }),
  ]);
  if (!control) return false;
  await control.click();
  const option = await firstVisible([
    page.getByRole('option', { name: new RegExp(escapeRegExp(value), 'i') }),
    page.getByText(new RegExp('^' + escapeRegExp(value) + '$', 'i')),
  ]);
  if (!option) return false;
  await option.click();
  return true;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function publishMarketplace(page, payload, context) {
  let downloaded;
  try {
    await validateMarketplace(page);

    if (!payload.title || payload.price === undefined || !payload.category) {
      throw new FacebookAutomationError(
        'INVALID_MARKETPLACE_PAYLOAD',
        'Marketplace title, price and category are required'
      );
    }
    if (!payload.media?.length) {
      throw new FacebookAutomationError(
        'INVALID_MARKETPLACE_PAYLOAD',
        'Marketplace requires at least one image'
      );
    }

    downloaded = await downloadMedia(payload.media, context.config, context.jobId);
    const fileInput = page.locator('input[type="file"]').first();
    if ((await fileInput.count()) === 0) {
      throw new FacebookAutomationError(
        'MEDIA_UPLOAD_FAILED',
        'Could not find Marketplace image upload input'
      );
    }
    await fileInput.setInputFiles(downloaded.files);

    if (!(await fillField(page, RX.title, payload.title))) {
      throw new FacebookAutomationError('SELECTOR_BROKEN', 'Marketplace title field not found');
    }
    if (!(await fillField(page, RX.price, payload.price))) {
      throw new FacebookAutomationError('SELECTOR_BROKEN', 'Marketplace price field not found');
    }
    if (!(await fillField(page, RX.description, payload.description || ''))) {
      throw new FacebookAutomationError(
        'SELECTOR_BROKEN',
        'Marketplace description field not found'
      );
    }
    if (!(await chooseOption(page, RX.category, payload.category))) {
      throw new FacebookAutomationError(
        'UNSUPPORTED_MARKETPLACE_FORM',
        'Marketplace category could not be selected: ' + payload.category
      );
    }
    if (payload.condition) {
      await chooseOption(page, RX.condition, payload.condition);
    }
    if (payload.location) {
      await fillField(page, RX.location, payload.location);
    }

    const nextButton = await firstVisible([
      page.getByRole('button', { name: RX.next }),
      page.getByText(RX.next, { exact: true }),
    ]);
    if (nextButton) {
      await nextButton.click();
      await page.waitForTimeout(800);
    }

    const publishButton = await firstVisible([
      page.getByRole('button', { name: RX.publish }),
      page.getByText(RX.publish, { exact: true }),
    ]);
    if (!publishButton) {
      throw new FacebookAutomationError(
        'SELECTOR_BROKEN',
        'Marketplace Publish button not found'
      );
    }

    await context.markPublishStarted();
    await publishButton.click();

    await page
      .waitForURL(/\/marketplace\/item\//i, { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(1000);

    let releaseUrl = /\/marketplace\/item\//i.test(page.url()) ? page.url() : '';
    if (!releaseUrl) {
      const links = await page
        .locator('a[href*="/marketplace/item/"]')
        .evaluateAll((nodes) => nodes.map((node) => node.href).filter(Boolean))
        .catch(() => []);
      releaseUrl = links[0] || '';
    }

    if (!releaseUrl) {
      throw new FacebookAutomationError(
        'UNKNOWN_OUTCOME',
        'Marketplace publish was submitted but the listing URL could not be confirmed'
      );
    }

    return {
      status: 'SUCCESS',
      remoteId: releaseUrl.match(/\/marketplace\/item\/([^/?]+)/i)?.[1] || context.jobId,
      releaseUrl,
    };
  } catch (error) {
    const code = classifyAutomationError(error);
    const screenshotPath = await screenshot(
      page,
      context.config,
      context.jobId,
      code
    );
    if (error instanceof FacebookAutomationError) {
      error.details = {
        ...error.details,
        screenshotPath,
        currentUrl: page.url(),
      };
      throw error;
    }
    throw new FacebookAutomationError(
      'UNKNOWN_ERROR',
      error?.message || 'Unknown Marketplace publishing error',
      { screenshotPath, currentUrl: page.url() }
    );
  } finally {
    await cleanDownloaded(downloaded);
  }
}
