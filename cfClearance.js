const { log } = require('./logger');

const FLARE_URL = process.env.CF_CLEARANCE_URL || 'http://localhost:8191';

async function getCfClearance(targetUrl) {
  log(`Requesting FlareSolverr for: ${targetUrl}`);

  const res = await fetch(`${FLARE_URL}/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'request.get',
      url: targetUrl,
      maxTimeout: 60000,
    }),
  });

  if (!res.ok) {
    throw new Error(`FlareSolverr responded ${res.status}`);
  }

  const data = await res.json();

  if (data.status !== 'ok') {
    throw new Error(`FlareSolverr error: ${data.message}`);
  }

  const cookies = data.solution.cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
  }));

  const userAgent = data.solution.userAgent;

  log(`FlareSolverr done, ua: ${userAgent}`);
  return { cookies, userAgent };
}

module.exports = { getCfClearance };
