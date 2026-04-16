require('dotenv').config();

const fsSync = require('fs');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { connect } = require('puppeteer-real-browser');

const { log, error } = require('./logger');
const { collectLinks } = require('./listParser');
const {
  loginIfNeeded,
  processPost,
  sleep,
} = require('./index');
const {
  getProcessedPostIds,
  getTodayProcessedCount,
  initStore,
} = require('./sqliteStore');

const LIST_LIMIT = Number(process.env.LIST_LIMIT || 200);
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 200);
const CYCLE_SLEEP_MS = Number(process.env.CYCLE_SLEEP_MS || 60000);
const ERROR_SLEEP_MS = Number(process.env.ERROR_SLEEP_MS || 120000);
const RETRY_SLEEP_MS = Number(process.env.RETRY_SLEEP_MS || 30000);
const HEADLESS = process.env.HEADLESS === 'true';
const WORKER_TEMP_DIR =
  process.env.WORKER_TEMP_DIR || path.join(os.tmpdir(), 'landbook-parser');

try {
  fsSync.mkdirSync(WORKER_TEMP_DIR, { recursive: true });
  process.env.TEMP = WORKER_TEMP_DIR;
  process.env.TMP = WORKER_TEMP_DIR;
} catch (err) {
  error(`Failed to prepare worker temp dir: ${WORKER_TEMP_DIR}`, err);
}

function msUntilNextDay() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

async function runCycle() {
  await initStore();

  const remainingBeforeConnect = DAILY_LIMIT - (await getTodayProcessedCount());
  if (remainingBeforeConnect <= 0) {
    const waitMs = Math.max(msUntilNextDay(), CYCLE_SLEEP_MS);
    log(`Daily limit reached (${DAILY_LIMIT}), sleeping ${Math.round(waitMs / 1000)}s`);
    return waitMs;
  }

  let browser = null;
  let page = null;

  ({ browser, page } = await connect({
    headless: HEADLESS,
    turnstile: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }));

  try {
    await loginIfNeeded(page);

    const processedIds = await getProcessedPostIds();
    const remaining = DAILY_LIMIT - (await getTodayProcessedCount());

    const limit = Math.min(LIST_LIMIT, remaining);
    log(`Cycle start: limit=${limit}, remaining=${remaining}`);

    const links = await collectLinks(page, limit, processedIds);

    if (!links.length) {
      log('No new links found, sleeping');
      return CYCLE_SLEEP_MS;
    }

    const results = [];

    for (const [i, item] of links.entries()) {
      const currentRemaining = DAILY_LIMIT - (await getTodayProcessedCount());
      if (currentRemaining <= 0) {
        log(`Daily limit reached (${DAILY_LIMIT}) during cycle`);
        break;
      }

      log(`[${i + 1}/${links.length}] ${item.url} (${item.likes})`);

      const result = await processPost(browser, item);
      if (result) results.push(result);

      await sleep(1500 + Math.random() * 2500);
    }

    await fs.writeFile(
      path.resolve('./results.json'),
      JSON.stringify(results, null, 2),
    );

    log(`Cycle done. Parsed this cycle: ${results.length}`);
    return CYCLE_SLEEP_MS;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function runWorker() {
  log('Worker started');
  await initStore();

  while (true) {
    try {
      const waitMs = await runCycle();
      await sleep(waitMs || CYCLE_SLEEP_MS);
    } catch (err) {
      error('Worker cycle failed', err);
      await sleep(ERROR_SLEEP_MS);
    }
  }
}

if (require.main === module) {
  runWorker();
}

module.exports = {
  runCycle,
  runWorker,
};

