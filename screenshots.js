const fs = require('fs');
const path = require('path');
const { log, error } = require('./logger');

const SCREENSHOTS_DIR = path.resolve('./screenshots');

async function captureDesktop(page, id) {
  try {
    const dir = path.join(SCREENSHOTS_DIR, String(id));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await page.setViewport({ width: 1440, height: 900 });
    await new Promise((r) => setTimeout(r, 1500));

    const filePath = path.join(dir, 'desktop.png');
    await page.screenshot({ path: filePath, fullPage: false });
    log(`Desktop screenshot saved: ${filePath}`);
    return filePath;
  } catch (err) {
    error(`Desktop screenshot failed for ID ${id}`, err);
    return null;
  }
}

async function captureMobile(page, id) {
  try {
    const dir = path.join(SCREENSHOTS_DIR, String(id));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await page.setViewport({
      width: 375,
      height: 812,
      isMobile: true,
      hasTouch: true,
    });
    await new Promise((r) => setTimeout(r, 1500));

    const filePath = path.join(dir, 'mobile.png');
    await page.screenshot({ path: filePath, fullPage: false });
    log(`Mobile screenshot saved: ${filePath}`);
    return filePath;
  } catch (err) {
    error(`Mobile screenshot failed for ID ${id}`, err);
    return null;
  }
}

async function captureAll(page, id) {
  const desktop = await captureDesktop(page, id);
  const mobile = await captureMobile(page, id);
  return { desktop, mobile };
}

module.exports = { captureDesktop, captureMobile, captureAll };
