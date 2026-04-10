require('dotenv').config();

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { log, error } = require('./logger');
const { parsePost } = require('./postParser');
const { captureAll } = require('./screenshots');

const TARGET_URL =
  process.argv[2] ||
  'https://land-book.com/websites/52770-pebble-where-home-meets-the-road';

async function run() {
  log(`Starting MVP parser for: ${TARGET_URL}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    );

    const postDate = await parsePost(page, TARGET_URL);

    if (!postDate?.id) {
      error('Failed to parse post data');
      return;
    }

    const screenshots = await captureAll(page, postDate.id);
    const result = {
      ...postDate,
      screenshots: {
        desktop: screenshots.desktop,
        mobile: screenshots.mobile,
      },
    };

    fs.writeFileSync(
      path.resolve('./result.json'),
      JSON.stringify(result, null, 2),
    );

    log('Done!');
    console.log('\n=== RESULT ===\n', JSON.stringify(result, null, 2));
  } catch (err) {
    error('Fatal error', err);
  } finally {
    await browser.close();
    log('Browser closed');
  }
}

run();
