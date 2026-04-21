require('dotenv').config();
const { getCfClearance } = require('./cfClearance');

const fs = require('fs/promises');
const path = require('path');

const { log, error } = require('./logger');
const { parsePost } = require('./postParser');
const { downloadImage } = require('./imageDownloader');
const {
  hasProcessedSourceUrl,
  saveProcessedPost,
  recordDeliverySuccess,
  recordDeliveryFailure,
} = require('./sqliteStore');
const { uploadFile, sendModerationContent } = require('./x6senseClient');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toUploadAsset(upload) {
  if (!upload) return null;

  return {
    id: upload.id || null,
    url: upload.url || null,
    webpUrl: upload.webpUrl || null,
    width: upload.width || null,
    height: upload.height || null,
    createdAt: upload.createdAt || null,
  };
}

function buildCaseNode(
  postData,
  { imageUpload = null, parentUrl = null, variant = 'page' } = {},
) {
  const {
    full_image_url,
    mobile_image_url,
    likes: _likes,
    title,
    pages: nestedPages = [],
    pages_count,
    ...rest
  } = postData;

  return {
    ...rest,
    title,
    image: toUploadAsset(imageUpload),
    pages_count: pages_count ?? null,
    pages: nestedPages,
    parent_url: parentUrl || null,
    variant,
  };
}

async function downloadAndUploadImage(imageUrl, filePath) {
  if (!imageUrl || !filePath) return null;

  await downloadImage(imageUrl, filePath);
  log(`Image saved: ${filePath}`);
  return uploadFile(filePath);
}

async function parseNestedCasePages(browser, pages, parentUrl, dir) {
  const parsedPages = [];

  for (const item of pages || []) {
    if (!item?.url) continue;

    const childPage = await browser.newPage();

    try {
      const childData = await parsePost(childPage, item.url, {
        includePages: false,
      });
      if (!childData?.id) {
        parsedPages.push({
          ...item,
          parent_url: parentUrl,
          variant: 'page',
        });
        continue;
      }

      let childUpload = null;
      if (childData.full_image_url) {
        const childDir = path.join(dir, 'pages', childData.id);
        await fs.mkdir(childDir, { recursive: true });
        const childPath = path.join(childDir, 'desktop.webp');
        childUpload = await downloadAndUploadImage(
          childData.full_image_url,
          childPath,
        );
      }

      parsedPages.push(
        buildCaseNode(childData, {
          imageUpload: childUpload,
          parentUrl,
          variant: 'page',
        }),
      );
    } catch (err) {
      error(`Failed to parse nested page: ${item.url}`, err);
      parsedPages.push({
        ...item,
        parent_url: parentUrl,
        variant: 'page',
        image: null,
      });
    } finally {
      await childPage.close();
    }
  }

  return parsedPages;
}

async function cleanupLocalImages(files, dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
    log(`Removed local dir tree: ${dir}`);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      error(`Failed to remove local dir: ${dir}`, err);
    }
  }
}

async function loginIfNeeded(page) {
  const email = process.env.LANDBOOK_EMAIL;
  const password = process.env.LANDBOOK_PASSWORD;

  if (!email || !password) {
    log('No credentials, skipping login');
    return;
  }

  try {
    await page.goto('https://land-book.com/login', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const accept = buttons.find(
        (b) =>
          b.textContent?.toLowerCase().includes('accept all') ||
          b.textContent?.toLowerCase().includes('accept'),
      );
      if (accept) accept.click();
    });
    await sleep(1000);

    if (!page.url().includes('/login')) {
      log('Already logged in');
      return;
    }

    log('Logging in...');

    await page.type('input[type="email"]', email, { delay: 50 });
    await page.type('input[type="password"]', password, { delay: 50 });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type="submit"]'),
    ]);

    log('Login done');
  } catch (e) {
    error('Login failed', e);
  }
}

async function sendToX6Sense({ postData, desktopUpload, sourceUrl }) {
  log(`SKIP_DELIVERY=${process.env.SKIP_DELIVERY}`);
  if (process.env.SKIP_DELIVERY === 'true') {
    log('Delivery skipped (SKIP_DELIVERY=true)');
    return { ok: true, skipped: true };
  }

  try {
    const likesValue = postData.likes ?? 0;
    const {
      likes: _likes,
      title: _title,
      full_image_url: _full_image_url,
      mobile_image_url: _mobile_image_url,
      pages: _pages,
      pages_count: _pages_count,
      ...metaRest
    } = postData;
    const meta = {
      ...metaRest,
      title: `${likesValue} likes`,
      image: toUploadAsset(desktopUpload),
    };

    if (!desktopUpload?.id) {
      return {
        ok: false,
        stage: 'upload',
        error: 'No uploaded desktop image available',
      };
    }

    const moderation = await sendModerationContent({
      files: [desktopUpload.id],
      sourceUrl,
      type: 'image',
      parser: 'LANDBOOK',
      meta,
    });

    return {
      ok: true,
      uploads: [
        {
          kind: 'desktop',
          upload: desktopUpload,
          moderation,
        },
      ],
    };
  } catch (err) {
    error(`X6Sense delivery failed for ${postData?.id || sourceUrl}`, err);
    return {
      ok: false,
      stage: 'delivery',
      error: err?.message || String(err),
    };
  }
}

async function processPost(browser, item) {
  const { url, likes = 0 } = item;

  if (await hasProcessedSourceUrl(url)) {
    log(`Skip already processed: ${url}`);
    return null;
  }

  const page = await browser.newPage();

  try {
    const { cookies, userAgent } = await getCfClearance(url);
    await page.setUserAgent(userAgent);
    await page.setCookie(...cookies);

    const postData = await parsePost(page, url);

    if (!postData?.id) {
      throw new Error(`No post id for ${url}`);
    }

    const dir = path.join('./images', postData.id);
    await fs.mkdir(dir, { recursive: true });

    let desktopPath = null;
    let mobilePath = null;
    let desktopUpload = null;
    let mobileUpload = null;

    if (postData.full_image_url) {
      desktopPath = path.join(dir, 'desktop.webp');
      desktopUpload = await downloadAndUploadImage(
        postData.full_image_url,
        desktopPath,
      );
    }

    if (postData.mobile_image_url) {
      mobilePath = path.join(dir, 'mobile.webp');
      mobileUpload = await downloadAndUploadImage(
        postData.mobile_image_url,
        mobilePath,
      );
    }

    const nestedPages = await parseNestedCasePages(
      browser,
      postData.pages,
      postData.url,
      dir,
    );

    const caseData = {
      parent_url: postData.url,
      parent_id: postData.id,
      parent_title: postData.title,
      mobile: mobileUpload
        ? buildCaseNode(postData, {
            imageUpload: mobileUpload,
            parentUrl: postData.url,
            variant: 'mobile',
          })
        : null,
      pages: nestedPages,
      pages_count: nestedPages.length || 0,
    };

    const { full_image_url, mobile_image_url, ...rest } = postData;
    log(
      `Sending to x6sense: ${url}, desktopUpload: ${JSON.stringify(desktopUpload)}`,
    );
    const delivery = await sendToX6Sense({
      postData: {
        ...rest,
        likes,
        desktop_image_url: desktopUpload
          ? desktopUpload.url || desktopUpload.webpUrl || null
          : null,
        mobile_image_url: mobileUpload
          ? mobileUpload.url || mobileUpload.webpUrl || null
          : null,
        case: caseData,
      },
      desktopUpload,
      sourceUrl: url,
      likes,
    });
    log(`Delivery result: ${JSON.stringify(delivery)}`);

    if (delivery.ok) {
      if (delivery.skipped) {
        const saved = await saveProcessedPost({
          sourceUrl: url,
          fileId: `skipped:${postData.id}`,
          parsedAt: rest.parsed_at,
        });

        if (!saved) {
          log(`Skip already processed after delivery: ${url}`);
          return null;
        }

        await cleanupLocalImages([desktopPath, mobilePath], dir);

        return {
          ...rest,
          likes,
          images: {
            desktop: desktopPath,
            mobile: mobilePath,
          },
          delivery,
        };
      }

      const fileId = JSON.stringify(
        delivery.uploads.map((item) => item.upload.id),
      );

      const saved = await saveProcessedPost({
        sourceUrl: url,
        fileId,
        parsedAt: rest.parsed_at,
      });

      if (!saved) {
        log(`Skip already processed after delivery: ${url}`);
        return null;
      }

      await recordDeliverySuccess();
      await cleanupLocalImages([desktopPath, mobilePath], dir);

      return {
        ...rest,
        likes,
        images: {
          desktop: desktopPath,
          mobile: mobilePath,
        },
        delivery,
      };
    } else {
      await recordDeliveryFailure();
    }

    return {
      ...rest,
      likes,
      images: {
        desktop: desktopPath,
        mobile: mobilePath,
      },
      delivery,
    };
  } catch (err) {
    error(`Failed post ${item?.url}`, err);
    await recordDeliveryFailure();
    return null;
  } finally {
    await page.close();
  }
}

module.exports = {
  sleep,
  loginIfNeeded,
  sendToX6Sense,
  processPost,
};
