require('dotenv').config();

const { createStatusServer } = require('./statusServer');
const { log, error } = require('./logger');

const port = Number(process.env.PORT || process.env.STATUS_PORT || 3000);

async function main() {
  const server = createStatusServer({ port });

  try {
    await server.start();
    log(`Status server is listening on ${port}`);
  } catch (err) {
    error('Failed to start status server', err);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
};
