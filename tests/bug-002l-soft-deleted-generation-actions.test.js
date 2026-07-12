const assert = require('assert');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

process.env.DATABASE_URL = path.join('/tmp', 'copyquick-bug-002l-test.sqlite');
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(process.env.DATABASE_URL + suffix);
  } catch (err) {
    // Temp database may not exist yet.
  }
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const generationRoutes = require('../routes/generations');

function request(server, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path: url,
      headers: payload ? {
        'Content-Type': 'application/json',
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

function createApp(currentUser) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.session = { userId: currentUser.id };
    res.locals.user = currentUser;
    next();
  });
  app.use(generationRoutes);
  return app;
}

function parseJson(response) {
  return JSON.parse(response.body || '{}');
}

function insertGeneration(db, userId, overrides = {}) {
  const results = JSON.stringify([{ text: 'Original copy', tone: 'professional' }]);
  return db.prepare(`
    INSERT INTO generations (
      user_id, title, input_text, content_type, tone, results, word_count,
      tags, favorite, is_deleted, deleted_at, generation_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    overrides.title || 'Original title',
    overrides.input_text || 'Acme product',
    overrides.content_type || 'subject_line',
    overrides.tone || 'professional',
    overrides.results || results,
    overrides.word_count || 2,
    overrides.tags || '',
    overrides.favorite || 0,
    overrides.is_deleted || 0,
    overrides.is_deleted ? '2026-01-01T00:00:00.000Z' : null,
    overrides.generation_type || 'quick'
  ).lastInsertRowid;
}

async function run() {
  initDb();
  const db = getDb();
  const ownerId = db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit, generations_used)
    VALUES (?, ?, ?, ?, ?)
  `).run('owner@example.com', 'Owner', 'free', 10, 0).lastInsertRowid;
  const otherUserId = db.prepare(`
    INSERT INTO users (email, name, plan_tier, monthly_limit)
    VALUES (?, ?, ?, ?)
  `).run('other@example.com', 'Other', 'free', 10).lastInsertRowid;

  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(ownerId);
  const deletedId = insertGeneration(db, ownerId, { is_deleted: 1, title: 'Deleted title', tags: 'old', favorite: 0 });
  const otherGenId = insertGeneration(db, otherUserId);
  const server = await listen(createApp(owner));

  try {
    const initialGenerationCount = db.prepare('SELECT COUNT(*) AS count FROM generations').get().count;
    const initialEvents = db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count;
    const initialUsagePeriods = db.prepare('SELECT COUNT(*) AS count FROM usage_periods').get().count;
    const initialOwner = db.prepare('SELECT generations_used, current_period_used FROM users WHERE id = ?').get(ownerId);

    const viewDeleted = await request(server, 'GET', `/generation/${deletedId}`);
    assert.strictEqual(viewDeleted.res.statusCode, 404);

    const favoriteDeleted = await request(server, 'POST', `/generation/${deletedId}/favorite`);
    assert.strictEqual(favoriteDeleted.res.statusCode, 404);
    assert.strictEqual(parseJson(favoriteDeleted).error, 'Not found');

    const renameDeleted = await request(server, 'POST', `/generation/${deletedId}/title`, { title: 'Changed' });
    assert.strictEqual(renameDeleted.res.statusCode, 404);
    assert.strictEqual(parseJson(renameDeleted).error, 'Not found');

    const tagsDeleted = await request(server, 'POST', `/generation/${deletedId}/tags`, { tags: 'changed' });
    assert.strictEqual(tagsDeleted.res.statusCode, 404);
    assert.strictEqual(parseJson(tagsDeleted).error, 'Not found');

    const regenerateDeleted = await request(server, 'POST', `/generation/${deletedId}/regenerate`);
    assert.strictEqual(regenerateDeleted.res.statusCode, 404);
    assert.strictEqual(parseJson(regenerateDeleted).error, 'Not found');

    const exportDeleted = await request(server, 'GET', `/generation/${deletedId}/export?format=txt`);
    assert.strictEqual(exportDeleted.res.statusCode, 404);
    assert.strictEqual(exportDeleted.body, 'Not found');

    const blockedRow = db.prepare('SELECT title, tags, favorite, is_deleted FROM generations WHERE id = ?').get(deletedId);
    assert.deepStrictEqual(blockedRow, {
      title: 'Deleted title',
      tags: 'old',
      favorite: 0,
      is_deleted: 1
    });
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations').get().count, initialGenerationCount);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events').get().count, initialEvents);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_periods').get().count, initialUsagePeriods);
    assert.deepStrictEqual(db.prepare('SELECT generations_used, current_period_used FROM users WHERE id = ?').get(ownerId), initialOwner);

    const restoreDeleted = await request(server, 'POST', `/generation/${deletedId}/restore`);
    assert.strictEqual(restoreDeleted.res.statusCode, 200);
    assert.strictEqual(parseJson(restoreDeleted).success, true);
    assert.strictEqual(db.prepare('SELECT is_deleted FROM generations WHERE id = ?').get(deletedId).is_deleted, 0);

    const viewRestored = await request(server, 'GET', `/generation/${deletedId}`);
    assert.strictEqual(viewRestored.res.statusCode, 200);

    const favoriteRestored = await request(server, 'POST', `/generation/${deletedId}/favorite`);
    assert.strictEqual(favoriteRestored.res.statusCode, 200);
    assert.strictEqual(parseJson(favoriteRestored).favorite, true);

    const tagsRestored = await request(server, 'POST', `/generation/${deletedId}/tags`, { tags: 'restored' });
    assert.strictEqual(tagsRestored.res.statusCode, 200);
    assert.strictEqual(parseJson(tagsRestored).success, true);

    const titleRestored = await request(server, 'POST', `/generation/${deletedId}/title`, { title: 'Restored title' });
    assert.strictEqual(titleRestored.res.statusCode, 200);
    assert.strictEqual(parseJson(titleRestored).title, 'Restored title');

    const exportRestored = await request(server, 'GET', `/generation/${deletedId}/export?format=txt`);
    assert.strictEqual(exportRestored.res.statusCode, 200);
    assert(exportRestored.body.includes('Original copy'));

    const regenerateRestored = await request(server, 'POST', `/generation/${deletedId}/regenerate`);
    assert.strictEqual(regenerateRestored.res.statusCode, 200);
    assert(Array.isArray(parseJson(regenerateRestored).results));
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE event_type = ?').get('regeneration').count, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM generations').get().count, initialGenerationCount);
    assert.strictEqual(db.prepare('SELECT usage_count FROM usage_periods WHERE user_id = ?').get(ownerId).usage_count, 1);

    const otherFavorite = await request(server, 'POST', `/generation/${otherGenId}/favorite`);
    assert.strictEqual(otherFavorite.res.statusCode, 404);
    assert.strictEqual(parseJson(otherFavorite).error, 'Not found');

    const otherExport = await request(server, 'GET', `/generation/${otherGenId}/export?format=txt`);
    assert.strictEqual(otherExport.res.statusCode, 404);

    const deleteRestored = await request(server, 'POST', `/generation/${deletedId}/delete`);
    assert.strictEqual(deleteRestored.res.statusCode, 200);
    assert.strictEqual(parseJson(deleteRestored).success, true);
    const deletedAt = db.prepare('SELECT deleted_at FROM generations WHERE id = ?').get(deletedId).deleted_at;

    const deleteAgain = await request(server, 'POST', `/generation/${deletedId}/delete`);
    assert.strictEqual(deleteAgain.res.statusCode, 200);
    assert.strictEqual(parseJson(deleteAgain).success, true);
    assert.strictEqual(db.prepare('SELECT deleted_at FROM generations WHERE id = ?').get(deletedId).deleted_at, deletedAt);
  } finally {
    server.close();
  }
}

run()
  .then(() => {
    console.log('BUG-002L soft-deleted generation action tests passed');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
