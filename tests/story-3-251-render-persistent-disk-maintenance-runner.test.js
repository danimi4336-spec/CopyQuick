'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const packageJson = require('../package.json');
const { MAINTENANCE_MESSAGE, createMaintenanceServer, parsePort } = require('../scripts/maintenance-server');

const projectRoot = path.resolve(__dirname, '..');
const runnerPath = path.join(projectRoot, 'scripts', 'maintenance-server.js');

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const outbound = http.get({ host: '127.0.0.1', port, path: pathname }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outbound.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function hash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function schemaFixture(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `copyquick-maintenance-v${version}-`));
  const databasePath = path.join(root, 'copyquick.sqlite');
  const database = new Database(databasePath);
  database.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);');
  database.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(version);
  database.close();
  return { root, databasePath, version };
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('maintenance runner did not exit after SIGTERM')), 5000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('maintenance runner did not start')), 5000);
    child.stdout.on('data', chunk => {
      if (!chunk.toString().includes('Maintenance server listening')) return;
      clearTimeout(timer);
      resolve();
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`maintenance runner exited early (${code})`));
    });
  });
}

async function run() {
  assert.strictEqual(process.version, 'v24.20.0');
  assert.strictEqual(packageJson.scripts.start, 'node server.js');
  assert.strictEqual(packageJson.scripts['start:maintenance'], 'node scripts/maintenance-server.js');
  assert.strictEqual(packageJson.scripts['migrate:database'], 'node scripts/migrate-database.js');

  const renderYaml = fs.readFileSync(path.join(projectRoot, 'render.yaml'), 'utf8');
  assert.match(renderYaml, /startCommand:\s*node server\.js/);
  assert.doesNotMatch(renderYaml, /start:maintenance/);
  assert.strictEqual(parsePort('0'), 0);
  assert.throws(() => parsePort('abc'), /PORT/);

  const source = fs.readFileSync(runnerPath, 'utf8');
  const imports = [...source.matchAll(/require\((['"])(.*?)\1\)/g)].map(match => match[2]);
  assert.deepStrictEqual(imports, ['node:http']);
  for (const forbidden of [
    '../db', '../app', 'better-sqlite3', 'stripe', 'resend', 'openai', 'research',
    'backup', 'migration', 'scheduler', 'setInterval', 'setTimeout'
  ]) assert.ok(!source.toLowerCase().includes(forbidden.toLowerCase()), `runner contains forbidden dependency: ${forbidden}`);

  const providerSentinel = http.createServer((_request, response) => {
    providerSentinel.hits += 1;
    response.end('unexpected');
  });
  providerSentinel.hits = 0;
  const providerPort = await listen(providerSentinel);
  const previousProvider = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${providerPort}`;
  const fixtures = [schemaFixture(2), schemaFixture(8)];

  try {
    for (const fixture of fixtures) {
      const before = hash(fixture.databasePath);
      const previousDatabasePath = process.env.DATABASE_PATH;
      process.env.DATABASE_PATH = fixture.databasePath;
      const server = createMaintenanceServer();
      const port = await listen(server);
      for (const pathname of ['/', '/healthz', '/readyz', '/stripe/webhook', '/anything?value=1']) {
        const response = await request(port, pathname);
        assert.strictEqual(response.status, 503);
        assert.strictEqual(response.body, MAINTENANCE_MESSAGE);
        assert.strictEqual(response.headers['content-type'], 'text/plain; charset=utf-8');
        assert.strictEqual(response.headers['cache-control'], 'no-store');
      }
      await close(server);
      if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousDatabasePath;
      assert.strictEqual(hash(fixture.databasePath), before);
      const database = new Database(fixture.databasePath, { readonly: true });
      assert.strictEqual(database.prepare('SELECT MAX(version) version FROM schema_migrations').get().version, fixture.version);
      database.close();
    }
    assert.strictEqual(providerSentinel.hits, 0);
  } finally {
    if (previousProvider === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousProvider;
    await close(providerSentinel);
    for (const fixture of fixtures) fs.rmSync(fixture.root, { recursive: true, force: true });
  }

  const port = await reservePort();
  const child = spawn(process.execPath, [runnerPath], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForReady(child);
  assert.strictEqual((await request(port, '/')).status, 503);
  child.kill('SIGTERM');
  assert.deepStrictEqual(await waitForExit(child), { code: 0, signal: null });
  await assert.rejects(request(port, '/'));

  const runbook = fs.readFileSync(path.join(projectRoot, 'docs', 'DEPLOYMENT_READINESS_AUDIT.md'), 'utf8');
  for (const required of [
    'npm run start:maintenance', 'persistent disk', 'Render Maintenance Mode',
    'disk-attached shell', 'npm run migrate:database -- --confirm-production-migration',
    'same exact approved commit', 'node server.js', 'Disable Render Maintenance Mode only after recorded GO'
  ]) assert.ok(runbook.includes(required), `maintenance runbook missing ${required}`);

  console.log('Story 3.251 Render persistent-disk maintenance runner tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
