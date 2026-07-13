const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002q-test.sqlite');
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(process.env.DATABASE_URL + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

const generatorState = {
  calls: [],
  fail: false,
  consumeFinalCreditForUserId: null
};

const generatorModuleId = require.resolve('../lib/generator');
require.cache[generatorModuleId] = {
  id: generatorModuleId,
  filename: generatorModuleId,
  loaded: true,
  exports: {
    generateCopy: (input) => {
      generatorState.calls.push(input);
      if (generatorState.fail) {
        throw new Error('forced generator failure');
      }
      if (generatorState.consumeFinalCreditForUserId) {
        const { getDb } = require('../db/database');
        const db = getDb();
        db.prepare(`
          UPDATE usage_periods
          SET usage_count = monthly_limit
          WHERE user_id = ?
        `).run(generatorState.consumeFinalCreditForUserId);
        generatorState.consumeFinalCreditForUserId = null;
      }
      return [{ text: `Generated ${input.contentType || 'copy'} line\nSecond line`, tone: input.tone || 'professional' }];
    },
    getContentTypes: () => ({ subject_line: 'Subject Lines', sales_message: 'Sales Message' }),
    getTones: () => ['professional', 'casual']
  }
};

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const generationRoutes = require('../routes/generations');

function request(server, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? new URLSearchParams(body).toString() : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path: url,
      headers: payload ? {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      } : headers
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => resolve({ res, body: responseBody }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
  });
  return server;
}

function parseJson(response) {
  return JSON.parse(response.body || '{}');
}

function createApp(userId) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    req.session = { userId };
    res.locals.user = user;
    next();
  });
  app.use(generationRoutes);
  return app;
}

function createUser(db, overrides = {}) {
  return db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    overrides.email || `user-${Date.now()}-${Math.random()}@example.com`,
    overrides.name || 'Owner',
    overrides.plan_tier || 'free',
    overrides.monthly_limit ?? 10,
    overrides.generations_used ?? 0
  ).lastInsertRowid;
}

function insertGeneration(db, userId, overrides = {}) {
  return db.prepare(`
    INSERT INTO generations (
      user_id, title, input_text, content_type, tone, results, word_count,
      is_deleted, generation_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    overrides.title || 'Original title',
    overrides.input_text || 'Original product',
    overrides.content_type || 'subject_line',
    overrides.tone || 'professional',
    overrides.results || JSON.stringify([{ text: 'Original copy', tone: 'professional' }]),
    overrides.word_count ?? 2,
    overrides.is_deleted || 0,
    overrides.generation_type || 'quick'
  ).lastInsertRowid;
}

function generationBody(overrides = {}) {
  return {
    productDescription: overrides.productDescription || 'Acme product',
    targetAudience: overrides.targetAudience || 'busy founders',
    contentType: overrides.contentType || 'subject_line',
    tone: overrides.tone || 'professional',
    generationType: overrides.generationType || 'quick',
    assets: overrides.assets,
    campaignSections: overrides.campaignSections,
    goal: overrides.goal || 'Increase Sales'
  };
}

async function postGenerate(server, body = generationBody()) {
  return request(server, 'POST', '/dashboard/generate', body, { Accept: 'application/json' });
}

async function postRegenerate(server, generationId) {
  return request(server, 'POST', `/generation/${generationId}/regenerate`, null, { Accept: 'application/json' });
}

function resetGeneratorState() {
  generatorState.calls.length = 0;
  generatorState.fail = false;
  generatorState.consumeFinalCreditForUserId = null;
}

function snapshot(db, userId) {
  return {
    generations: db.prepare('SELECT COUNT(*) AS count FROM generations WHERE user_id = ?').get(userId).count,
    usageEvents: db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ?').get(userId).count,
    usageCount: db.prepare('SELECT COALESCE(SUM(usage_count), 0) AS count FROM usage_periods WHERE user_id = ?').get(userId).count,
    legacy: db.prepare('SELECT generations_used FROM users WHERE id = ?').get(userId).generations_used
  };
}

function assertSnapshotUnchanged(db, userId, before) {
  assert.deepStrictEqual(snapshot(db, userId), before);
}

async function withServer(userId, fn) {
  const server = await listen(createApp(userId));
  try {
    await fn(server);
  } finally {
    server.close();
  }
}

async function assertFailedGenerationRollsBack(db, triggerSql) {
  const userId = createUser(db, { monthly_limit: 10 });
  const before = snapshot(db, userId);
  db.exec(triggerSql);
  await withServer(userId, async (server) => {
    const response = await postGenerate(server);
    assert.strictEqual(response.res.statusCode, 500);
    assert.strictEqual(parseJson(response).error, 'Generation failed');
  });
  db.exec('DROP TRIGGER IF EXISTS fail_002q');
  assertSnapshotUnchanged(db, userId, before);
}

async function run() {
  initDb();
  const db = getDb();

  resetGeneratorState();
  const quickUserId = createUser(db, { monthly_limit: 10 });
  await withServer(quickUserId, async (server) => {
    const before = snapshot(db, quickUserId);
    const response = await postGenerate(server, generationBody({ generationType: 'quick' }));
    assert.strictEqual(response.res.statusCode, 200);
    const body = parseJson(response);
    assert.strictEqual(Array.isArray(body.results), true);
    assert.strictEqual(generatorState.calls.length, 1);
    assert.deepStrictEqual(snapshot(db, quickUserId), {
      generations: before.generations + 1,
      usageEvents: before.usageEvents + 1,
      usageCount: before.usageCount + 1,
      legacy: before.legacy + 1
    });
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ? AND event_type = ?').get(quickUserId, 'generation').count, 1);
  });

  resetGeneratorState();
  const bundleUserId = createUser(db, { monthly_limit: 10 });
  await withServer(bundleUserId, async (server) => {
    const response = await postGenerate(server, generationBody({
      generationType: 'bundle',
      assets: 'subject_line:Subject Lines,sales_message:Sales Message'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(generatorState.calls.length, 2);
    assert.strictEqual(snapshot(db, bundleUserId).usageEvents, 1);
    assert.strictEqual(snapshot(db, bundleUserId).usageCount, 1);
  });

  resetGeneratorState();
  const campaignUserId = createUser(db, { monthly_limit: 10 });
  await withServer(campaignUserId, async (server) => {
    const response = await postGenerate(server, generationBody({
      generationType: 'campaign',
      campaignSections: 'email,social'
    }));
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(generatorState.calls.length, 0);
    assert.strictEqual(snapshot(db, campaignUserId).generations, 1);
    assert.strictEqual(snapshot(db, campaignUserId).usageEvents, 1);
    assert.strictEqual(snapshot(db, campaignUserId).usageCount, 1);
  });

  resetGeneratorState();
  await assertFailedGenerationRollsBack(db, `
    CREATE TRIGGER fail_002q BEFORE UPDATE OF generations_used ON users
    BEGIN
      SELECT RAISE(ABORT, 'forced legacy counter failure');
    END;
  `);

  resetGeneratorState();
  await assertFailedGenerationRollsBack(db, `
    CREATE TRIGGER fail_002q BEFORE INSERT ON usage_events
    BEGIN
      SELECT RAISE(ABORT, 'forced usage event failure');
    END;
  `);

  resetGeneratorState();
  await assertFailedGenerationRollsBack(db, `
    CREATE TRIGGER fail_002q BEFORE UPDATE OF usage_count ON usage_periods
    BEGIN
      SELECT RAISE(ABORT, 'forced usage period failure');
    END;
  `);

  resetGeneratorState();
  const generatorFailUserId = createUser(db, { monthly_limit: 10 });
  const generatorFailBefore = snapshot(db, generatorFailUserId);
  generatorState.fail = true;
  await withServer(generatorFailUserId, async (server) => {
    const response = await postGenerate(server);
    assert.strictEqual(response.res.statusCode, 500);
    assert.strictEqual(parseJson(response).error, 'Generation failed');
  });
  assertSnapshotUnchanged(db, generatorFailUserId, generatorFailBefore);
  assert.strictEqual(generatorState.calls.length, 1);
  generatorState.fail = false;

  resetGeneratorState();
  const regenUserId = createUser(db, { monthly_limit: 10 });
  const regenId = insertGeneration(db, regenUserId);
  const originalResults = db.prepare('SELECT results FROM generations WHERE id = ?').get(regenId).results;
  await withServer(regenUserId, async (server) => {
    const response = await postRegenerate(server, regenId);
    assert.strictEqual(response.res.statusCode, 200);
    assert.strictEqual(generatorState.calls.length, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE user_id = ? AND event_type = ?').get(regenUserId, 'regeneration').count, 1);
    assert.strictEqual(snapshot(db, regenUserId).usageCount, 1);
    assert.strictEqual(snapshot(db, regenUserId).legacy, 1);
    assert.notStrictEqual(db.prepare('SELECT results FROM generations WHERE id = ?').get(regenId).results, originalResults);
  });

  resetGeneratorState();
  const failedRegenUserId = createUser(db, { monthly_limit: 10 });
  const failedRegenId = insertGeneration(db, failedRegenUserId);
  const failedRegenBefore = snapshot(db, failedRegenUserId);
  const failedRegenOriginal = db.prepare('SELECT results, word_count FROM generations WHERE id = ?').get(failedRegenId);
  db.exec(`
    CREATE TRIGGER fail_002q BEFORE INSERT ON usage_events
    BEGIN
      SELECT RAISE(ABORT, 'forced regeneration usage event failure');
    END;
  `);
  await withServer(failedRegenUserId, async (server) => {
    const response = await postRegenerate(server, failedRegenId);
    assert.strictEqual(response.res.statusCode, 500);
    assert.strictEqual(parseJson(response).error, 'Generation failed');
  });
  db.exec('DROP TRIGGER IF EXISTS fail_002q');
  assertSnapshotUnchanged(db, failedRegenUserId, failedRegenBefore);
  assert.deepStrictEqual(db.prepare('SELECT results, word_count FROM generations WHERE id = ?').get(failedRegenId), failedRegenOriginal);

  resetGeneratorState();
  const ownerId = createUser(db, { monthly_limit: 10 });
  const otherUserId = createUser(db, { monthly_limit: 10 });
  const deletedId = insertGeneration(db, ownerId, { is_deleted: 1 });
  const otherGenerationId = insertGeneration(db, otherUserId);
  await withServer(ownerId, async (server) => {
    let response = await postRegenerate(server, deletedId);
    assert.strictEqual(response.res.statusCode, 404);
    assert.strictEqual(parseJson(response).error, 'Not found');
    response = await postRegenerate(server, otherGenerationId);
    assert.strictEqual(response.res.statusCode, 404);
    assert.strictEqual(parseJson(response).error, 'Not found');
  });
  assert.strictEqual(generatorState.calls.length, 0);
  assert.strictEqual(snapshot(db, ownerId).usageEvents, 0);

  resetGeneratorState();
  const finalCreditUserId = createUser(db, { monthly_limit: 1 });
  await withServer(finalCreditUserId, async (server) => {
    const warmup = await postGenerate(server);
    assert.strictEqual(warmup.res.statusCode, 200);
    const blocked = await postGenerate(server);
    assert.strictEqual(blocked.res.statusCode, 403);
    assert.strictEqual(parseJson(blocked).error, 'Monthly limit reached');
  });
  assert.strictEqual(generatorState.calls.length, 1);
  assert.strictEqual(snapshot(db, finalCreditUserId).generations, 1);
  assert.strictEqual(snapshot(db, finalCreditUserId).usageEvents, 1);
  assert.strictEqual(snapshot(db, finalCreditUserId).usageCount, 1);

  resetGeneratorState();
  const staleFinalCreditUserId = createUser(db, { monthly_limit: 1 });
  generatorState.consumeFinalCreditForUserId = staleFinalCreditUserId;
  await withServer(staleFinalCreditUserId, async (server) => {
    const response = await postGenerate(server);
    assert.strictEqual(response.res.statusCode, 403);
    assert.strictEqual(parseJson(response).error, 'Monthly limit reached');
  });
  assert.strictEqual(generatorState.calls.length, 1);
  assert.deepStrictEqual(snapshot(db, staleFinalCreditUserId), {
    generations: 0,
    usageEvents: 0,
    usageCount: 1,
    legacy: 0
  });

  console.log('BUG-002Q atomic generation usage tests passed');
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
