const { resetStore } = require('../sqliteStore');
const { log, error } = require('../logger');

async function main() {
  try {
    await resetStore();
    log('SQLite database has been reset');
  } catch (err) {
    error('Failed to reset SQLite database', err);
    process.exitCode = 1;
  }
}

main();
