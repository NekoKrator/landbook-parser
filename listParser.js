const { log } = require('./logger');

const BASE_URL = 'https://land-book.com';

async function collectPostCards(page) {
  return await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-analytics-item-id]');
    const results = [];

    for (const card of cards) {
      const linkEl = card.querySelector('a[href*="/websites/"]');
      if (!linkEl) continue;

      const url = linkEl.href;
      if (!url || !url.includes('/websites/')) continue;

      let likes = 0;
      const likeCandidates = card.querySelectorAll('span, div');

      for (const el of likeCandidates) {
        const text = el.textContent?.trim();
        if (!text) continue;

        if (/^\d+$/.test(text)) {
          const val = parseInt(text, 10);
          if (val > likes && val < 1000000) {
            likes = val;
          }
        }
      }

      results.push({ url, likes });
    }

    const map = new Map();
    for (const r of results) {
      if (!map.has(r.url)) map.set(r.url, r);
    }

    return Array.from(map.values());
  });
}

async function collectLinks(page, limit = 200, processedIds = new Set()) {
  const items = [];
  const seen = new Set();
  const firstUrl = `${BASE_URL}/?sort=like&from=all`;

  log(`Opening list: ${firstUrl}`);

  await page.goto(firstUrl, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  await page
    .waitForSelector('[data-analytics-item-id]', {
      timeout: 15000,
    })
    .catch(() => {
      log('Warning: no cards found');
    });

  let pageNum = 1;

  while (items.length < limit) {
    log(`Parsing page ${pageNum}`);

    const pageItems = await collectPostCards(page);

    if (!pageItems.length) {
      log('No more items found');
      break;
    }

    for (const item of pageItems) {
      const idMatch = item.url.match(/\/(\d+)-/);
      const id = idMatch ? idMatch[1] : null;

      if (!id || processedIds.has(id) || seen.has(item.url)) continue;

      seen.add(item.url);
      items.push(item);

      if (items.length >= limit) break;
    }

    log(`Collected: ${items.length}`);

    if (items.length >= limit) break;

    pageNum++;

    const nextUrl = `${BASE_URL}/?sort=like&from=all&page=${pageNum}`;

    await page.goto(nextUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1200));
  }

  log(`Total collected: ${items.length}`);

  return items.slice(0, limit);
}

module.exports = {
  collectLinks,
};
