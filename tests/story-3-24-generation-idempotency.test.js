const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.DATABASE_PATH = path.join('/tmp', `copyquick-story-3-24-${process.pid}.sqlite`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(process.env.DATABASE_PATH + suffix); } catch (_) {}
}

const { initDb } = require('../db/init');
const { getDb } = require('../db/database');
const {
  GenerationRequestError,
  beginGenerationRequest,
  completeGenerationRequest,
  failGenerationRequest
} = require('../lib/generationIdempotency');

function rejectsCode(fn, code) {
  assert.throws(fn, error => error instanceof GenerationRequestError && error.code === code);
}

function createUser(db, email) {
  return db.prepare('INSERT INTO users(email, name) VALUES (?, ?)').run(email, 'Owner').lastInsertRowid;
}

function createGeneration(db, userId) {
  return db.prepare(`
    INSERT INTO generations(user_id, input_text, content_type, results)
    VALUES (?, 'Safe request', 'subject_line', '[]')
  `).run(userId).lastInsertRowid;
}

function run() {
  initDb();
  const db = getDb();
  const userId = createUser(db, 'story-3-24@example.com');
  const otherUserId = createUser(db, 'story-3-24-other@example.com');
  const request = { prompt: 'private customer input', tone: 'professional' };
  const key = 'request-key-000000000001';

  assert.deepStrictEqual(beginGenerationRequest(db, {
    userId, operation: 'dashboard_generation', key: null, request
  }), { enabled: false });
  rejectsCode(() => beginGenerationRequest(db, {
    userId, operation: 'dashboard_generation', key: 'short', request
  }), 'IDEMPOTENCY_KEY_INVALID');

  const claimed = beginGenerationRequest(db, {
    userId, operation: 'dashboard_generation', key, request
  });
  assert.strictEqual(claimed.replay, false);
  rejectsCode(() => beginGenerationRequest(db, {
    userId, operation: 'dashboard_generation', key, request
  }), 'GENERATION_REQUEST_IN_PROGRESS');
  rejectsCode(() => beginGenerationRequest(db, {
    userId, operation: 'dashboard_generation', key, request: { ...request, tone: 'casual' }
  }), 'IDEMPOTENCY_KEY_REUSED');

  const generationId = createGeneration(db, userId);
  completeGenerationRequest(db, claimed.requestId, generationId);
  const replay = beginGenerationRequest(db, {
    userId, operation: 'dashboard_generation', key, request
  });
  assert.strictEqual(replay.replay, true);
  assert.strictEqual(replay.generationId, generationId);

  const sameKeyOtherUser = beginGenerationRequest(db, {
    userId: otherUserId, operation: 'dashboard_generation', key, request
  });
  assert.strictEqual(sameKeyOtherUser.replay, false);

  const failed = beginGenerationRequest(db, {
    userId, operation: 'dashboard_generation', key: 'request-key-000000000002', request
  });
  failGenerationRequest(db, failed.requestId, 'PROVIDER_SECRET_DETAIL!');
  rejectsCode(() => beginGenerationRequest(db, {
    userId, operation: 'dashboard_generation', key: 'request-key-000000000002', request
  }), 'GENERATION_REQUEST_FAILED');

  const rows = db.prepare('SELECT * FROM generation_requests WHERE user_id = ? ORDER BY id').all(userId);
  assert.strictEqual(rows.length, 2);
  assert(rows.every(row => row.request_hash.length === 64));
  assert(rows.every(row => !JSON.stringify(row).includes('private customer input')));
  assert.strictEqual(rows[1].error_code, 'GENERATION_FAILED');

  console.log('Story 3.24 generation idempotency tests passed');
}

try {
  run();
} finally {
  try { getDb().close(); } catch (_) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DATABASE_PATH + suffix); } catch (_) {}
  }
}
