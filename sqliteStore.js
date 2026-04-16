const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js/dist/sql-asm.js');

const DATA_DIR = path.resolve('./data');
const DB_PATH = path.join(DATA_DIR, 'landbook.sqlite');
const TIME_ZONE = process.env.TIME_ZONE || 'Europe/Kiev';

let SQL = null;
let db = null;
let readyPromise = null;

function getDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(date, delta) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + delta);
  return copy;
}

function persistDb() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function createFreshDb() {
  db = new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS parsed_posts (
      source_url TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      parsed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stats (
      stat_date TEXT PRIMARY KEY,
      parsed_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  persistDb();
}

async function initStore() {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 0) {
      db = new SQL.Database(fs.readFileSync(DB_PATH));
      db.run(`
        CREATE TABLE IF NOT EXISTS parsed_posts (
          source_url TEXT PRIMARY KEY,
          file_id TEXT NOT NULL,
          parsed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stats (
          stat_date TEXT PRIMARY KEY,
          parsed_count INTEGER NOT NULL DEFAULT 0,
          delivered_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      persistDb();
    } else {
      createFreshDb();
    }

    return true;
  })();

  return readyPromise;
}

async function ensureReady() {
  await initStore();
}

function selectOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const hasRow = stmt.step();
  const row = hasRow ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function selectAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function hasProcessedSourceUrl(sourceUrl) {
  await ensureReady();
  return !!selectOne(
    'SELECT 1 AS found FROM parsed_posts WHERE source_url = ? LIMIT 1',
    [sourceUrl],
  );
}

async function getProcessedPostIds() {
  await ensureReady();
  const rows = selectAll('SELECT source_url FROM parsed_posts');

  const ids = new Set();
  for (const row of rows) {
    const match = String(row.source_url || '').match(/\/(\d+)-/);
    if (match) ids.add(match[1]);
  }

  return ids;
}

function incrementStat(column, dateKey = getDateKey()) {
  const existing = selectOne(
    'SELECT stat_date FROM stats WHERE stat_date = ? LIMIT 1',
    [dateKey],
  );

  if (existing) {
    db.run(
      `UPDATE stats
       SET ${column} = ${column} + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE stat_date = ?`,
      [dateKey],
    );
  } else {
    const base = {
      parsed_count: 0,
      delivered_count: 0,
      failed_count: 0,
    };
    base[column] = 1;
    db.run(
      `INSERT INTO stats (stat_date, parsed_count, delivered_count, failed_count, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [dateKey, base.parsed_count, base.delivered_count, base.failed_count],
    );
  }

  persistDb();
}

async function saveProcessedPost({ sourceUrl, fileId, parsedAt = new Date().toISOString() }) {
  await ensureReady();

  if (await hasProcessedSourceUrl(sourceUrl)) {
    return false;
  }

  try {
    db.run(
      'INSERT INTO parsed_posts (source_url, file_id, parsed_at) VALUES (?, ?, ?)',
      [sourceUrl, fileId, parsedAt],
    );
    incrementStat('parsed_count');
    return true;
  } catch (err) {
    if (String(err?.message || '').toLowerCase().includes('unique')) {
      return false;
    }
    throw err;
  }
}

async function recordDeliverySuccess() {
  await ensureReady();
  incrementStat('delivered_count');
}

async function recordDeliveryFailure() {
  await ensureReady();
  incrementStat('failed_count');
}

async function getTodayProcessedCount() {
  await ensureReady();
  const row = selectOne(
    'SELECT parsed_count FROM stats WHERE stat_date = ? LIMIT 1',
    [getDateKey()],
  );

  return row?.parsed_count || 0;
}

function fetchStatsRow(dateKey) {
  return (
    selectOne(
      `SELECT stat_date, parsed_count, delivered_count, failed_count, updated_at
       FROM stats
       WHERE stat_date = ?`,
      [dateKey],
    ) || null
  );
}

function sumStats(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.parsed += row.parsed_count || 0;
      acc.delivered += row.delivered_count || 0;
      acc.failed += row.failed_count || 0;
      return acc;
    },
    { parsed: 0, delivered: 0, failed: 0 },
  );
}

async function getStatistics({ date } = {}) {
  await ensureReady();

  if (date) {
    return {
      date,
      stats:
        fetchStatsRow(date) || {
          stat_date: date,
          parsed_count: 0,
          delivered_count: 0,
          failed_count: 0,
          updated_at: null,
        },
    };
  }

  const today = getDateKey();
  const weekStart = getDateKey(addDays(new Date(), -6));
  const todayRow = fetchStatsRow(today);
  const rows = selectAll(
    `SELECT stat_date, parsed_count, delivered_count, failed_count, updated_at
     FROM stats
     WHERE stat_date BETWEEN ? AND ?
     ORDER BY stat_date ASC`,
    [weekStart, today],
  );

  return {
    today,
    total: selectOne(
      `SELECT
         COALESCE(SUM(parsed_count), 0) AS parsed,
         COALESCE(SUM(delivered_count), 0) AS delivered,
         COALESCE(SUM(failed_count), 0) AS failed
       FROM stats`,
    ),
    todayStats:
      todayRow || {
        stat_date: today,
        parsed_count: 0,
        delivered_count: 0,
        failed_count: 0,
        updated_at: null,
      },
    weekStats: sumStats(rows),
    updatedAt: rows.at(-1)?.updated_at || null,
  };
}

async function resetStore() {
  await ensureReady();
  db = new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS parsed_posts (
      source_url TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      parsed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stats (
      stat_date TEXT PRIMARY KEY,
      parsed_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  persistDb();
}

module.exports = {
  initStore,
  hasProcessedSourceUrl,
  getProcessedPostIds,
  getTodayProcessedCount,
  saveProcessedPost,
  recordDeliverySuccess,
  recordDeliveryFailure,
  getStatistics,
  resetStore,
};
