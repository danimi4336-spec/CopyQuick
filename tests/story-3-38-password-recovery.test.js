const assert = require('assert');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const {
  RESET_TOKEN_MAX_LENGTH,
  createPasswordResetToken,
  resetPassword,
  validatePasswordResetToken
} = require('../lib/passwordRecovery');
const { sendPasswordResetEmail } = require('../lib/email');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT, google_id TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at TEXT NOT NULL);
  `);
  return db;
}

async function run() {
  const env = { NODE_ENV: 'test', SESSION_SECRET: 'story-3-38-secret' };
  const now = new Date('2026-08-31T12:00:00.000Z');
  const db = createDb();
  const oldHash = await bcrypt.hash('old-password', 4);
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(38, 'owner@example.com', oldHash, null);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('direct', JSON.stringify({ userId: 38 }), '2026-09-01');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('passport', JSON.stringify({ passport: { user: 38 } }), '2026-09-01');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('other', JSON.stringify({ userId: 99 }), '2026-09-01');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('malformed', '{bad', '2026-09-01');

  const user = db.prepare('SELECT * FROM users WHERE id = 38').get();
  const token = createPasswordResetToken(user, {
    env, now, ttlMs: 60 * 60 * 1000, randomBytes: () => Buffer.alloc(24, 7)
  });
  assert(!token.includes(oldHash));
  assert.strictEqual(validatePasswordResetToken(db, token, { env, now }).id, 38);
  assert.strictEqual(validatePasswordResetToken(db, `${token}tampered`, { env, now }), null);
  assert.strictEqual(validatePasswordResetToken(db, 'x'.repeat(RESET_TOKEN_MAX_LENGTH + 1), { env, now }), null);
  assert.strictEqual(validatePasswordResetToken(db, [token], { env, now }), null);
  assert.strictEqual(validatePasswordResetToken(db, `${token.split('.')[0]}.not+base64url`, { env, now }), null);
  assert.strictEqual(validatePasswordResetToken(db, token, { env, now: new Date('2026-08-31T13:00:00.001Z') }), null);

  assert.deepStrictEqual(await resetPassword(db, token, 'short', { env, now }), { ok: false, code: 'PASSWORD_INVALID' });
  const reset = await resetPassword(db, token, 'new-secure-password', {
    env, now, bcrypt: { hash: async value => `new-hash:${value}` }
  });
  assert.strictEqual(reset.ok, true);
  assert.strictEqual(reset.sessionsRevoked, 2);
  assert.strictEqual(db.prepare('SELECT password_hash FROM users WHERE id = 38').get().password_hash, 'new-hash:new-secure-password');
  assert.deepStrictEqual(db.prepare('SELECT id FROM sessions ORDER BY id').all().map(row => row.id), ['malformed', 'other']);
  assert.strictEqual(validatePasswordResetToken(db, token, { env, now }), null, 'successful reset must consume every old-credential token');
  assert.deepStrictEqual(await resetPassword(db, token, 'another-password', { env, now }), { ok: false, code: 'TOKEN_INVALID' });

  const google = { id: 39, email: 'google@example.com', password_hash: null, google_id: 'google-39' };
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(google.id, google.email, null, google.google_id);
  const googleToken = createPasswordResetToken(google, { env, now });
  assert.strictEqual(validatePasswordResetToken(db, googleToken, { env, now }).id, 39);

  const deliveries = [];
  const resetUrl = `https://copyquick.example/reset-password?token=${encodeURIComponent(token)}`;
  await sendPasswordResetEmail({ email: 'owner@example.com', resetUrl }, {
    resendClient: { emails: { send: async (payload, deliveryOptions) => {
      deliveries.push({ payload, deliveryOptions });
      return { data: { id: 'email-reset-38' } };
    } } },
    sleep: async () => {},
    logger: () => {}
  });
  assert.strictEqual(deliveries.length, 1);
  assert.deepStrictEqual(deliveries[0].payload.to, ['owner@example.com']);
  assert(deliveries[0].payload.text.includes(resetUrl));
  assert(deliveries[0].payload.html.includes('Reset your password'));
  assert(!deliveries[0].deliveryOptions.idempotencyKey.includes(token));

  db.close();
  console.log('Story 3.38 password recovery tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
