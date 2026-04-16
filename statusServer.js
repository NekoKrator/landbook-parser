const http = require('http');
const url = require('url');
const { getStatistics } = require('./sqliteStore');

function createStatusServer({ port = 3000 } = {}) {
  let server = null;

  function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify(payload, null, 2));
  }

  return {
    start() {
      if (server) return Promise.resolve();

      server = http.createServer(async (req, res) => {
        const parsed = url.parse(req.url, true);

        if (req.method === 'GET' && parsed.pathname === '/health') {
          return sendJson(res, 200, {
            ok: true,
            active: true,
            timestamp: new Date().toISOString(),
          });
        }

        if (req.method === 'GET' && parsed.pathname === '/statistics') {
          const stats = await getStatistics({
            date:
              typeof parsed.query.date === 'string'
                ? parsed.query.date
                : undefined,
          });
          return sendJson(res, 200, stats);
        }

        return sendJson(res, 404, {
          ok: false,
          error: 'Not found',
        });
      });

      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, resolve);
      });
    },

    stop() {
      if (!server) return Promise.resolve();

      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
        server = null;
      });
    },
  };
}

module.exports = { createStatusServer };
