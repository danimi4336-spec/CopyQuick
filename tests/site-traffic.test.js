const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { createCsrfProtection } = require('../lib/csrf');
const { createTrafficRouter } = require('../routes/traffic');

const script = fs.readFileSync(require.resolve('../public/js/visitorCount.js'), 'utf8');
const stored = new Map();
const reports = [];
function visit(search, navigator = {}) {
  vm.runInNewContext(script, {
    navigator, crypto, URLSearchParams, location: { search },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    document: {
      visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
      querySelector: () => ({ content: 'csrf' })
    },
    fetch: async (url, options) => {
      assert.equal(url, '/traffic/visit');
      reports.push(JSON.parse(options.body));
    }
  });
}
visit('?ref=email-invite', { globalPrivacyControl: true });
assert.equal(stored.size, 0);
visit('');
visit('?ref=email-invite');
visit('');
assert.deepEqual(reports.map(r => r.emailInvite), [false, true, false]);
assert.equal(new Set(reports.map(r => r.browserId)).size, 1);

async function run() {
  const db = new Database(':memory:');
  runMigrationEngine(db);
  const app = express();
  app.set('view engine', 'ejs');
  app.use(express.json());
  app.use(session({ secret: 'isolated-traffic-test', resave: false, saveUninitialized: false }));
  app.use(createCsrfProtection());
  app.get('/test-token', (req, res) => res.send(res.locals.csrfToken));
  let authenticatedUser = null;
  app.use((req, res, next) => { res.locals.user = authenticatedUser; next(); });
  process.env.TRAFFIC_OWNER_USER_ID = '31';
  app.use(createTrafficRouter({ getDb: () => db }));
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(listener));
  });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(origin + '/test-token');
    const token = await response.text();
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const post = (data, headers = {}) => fetch(origin + '/traffic/visit', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...headers },
      body: JSON.stringify(data)
    });
    const report = () => fetch(origin + '/admin/traffic');
    assert.equal((await report()).status, 404);
    assert.equal((await post(reports[0], { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await post({ browserId: 'invalid', emailInvite: true })).status, 400);
    for (const data of reports) assert.equal((await post(data)).status, 204);
    await post({ ...reports[0], browserId: crypto.randomUUID() }, { 'Sec-GPC': '1' });
    await post({ ...reports[0], browserId: crypto.randomUUID() });
    authenticatedUser = { id: 30 };
    assert.equal((await report()).status, 404);
    authenticatedUser = { id: 31 };
    await post({ ...reports[0], browserId: crypto.randomUUID() });
    const result = await report();
    assert.equal(result.status, 200);
    const html = await result.text();
    assert.match(html, /Unique browsers<\/dt><dd><strong>2/);
    assert.match(html, /opened an email invitation<\/dt><dd><strong>1/);
    assert.match(html, /\?ref=email-invite/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
