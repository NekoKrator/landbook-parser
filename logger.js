function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function error(msg, err) {
  console.error(`[${new Date().toISOString()}] ERROR: ${msg}`, err || '');
}

module.exports = { log, error };
