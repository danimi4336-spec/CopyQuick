const assert = require('assert');
const Database = require('better-sqlite3');
const SQLiteStore = require('../lib/sessionStore');
const {
  DEFAULT_PRUNE_EVERY_WRITES,
  DEFAULT_PRUNE_LIMIT,
  pruneExpiredSessions
} = require('../lib/sessionStore');

function createDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at DATETIME NOT NULL
    )
  `);
  return db;
}

function insertSession(db, id, expiresAt) {
  db.prepare('INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)')
    .run(id, '{}', expiresAt);
}

function callSet(store, sid, sess) {
  return new Promise((resolve, reject) => {
    store.set(sid, sess, (err) => err ? reject(err) : resolve());
  });
}

function callGet(store, sid) {
  return new Promise((resolve, reject) => {
    store.get(sid, (err, sess) => err ? reject(err) : resolve(sess));
  });
}

async function run() {
  assert.strictEqual(DEFAULT_PRUNE_EVERY_WRITES, 100);
  assert.strictEqual(DEFAULT_PRUNE_LIMIT, 250);

  const now = new Date('2026-08-31T12:00:00.000Z');
  const db = createDatabase();
  insertSession(db, 'expired-oldest', '2026-08-01T00:00:00.000Z');
  insertSession(db, 'expired-middle', '2026-08-15T00:00:00.000Z');
  insertSession(db, 'expired-newest', '2026-08-30T00:00:00.000Z');
  insertSession(db, 'active', '2026-09-01T00:00:00.000Z');

  assert.strictEqual(pruneExpiredSessions(db, { now, limit: 2 }), 2);
  assert.deepStrictEqual(
    db.prepare('SELECT id FROM sessions ORDER BY id').all().map((row) => row.id),
    ['active', 'expired-newest']
  );
  assert.strictEqual(pruneExpiredSessions(db, { now, limit: 2 }), 1);
  assert.deepStrictEqual(db.prepare('SELECT id FROM sessions').all(), [{ id: 'active' }]);
  assert.strictEqual(pruneExpiredSessions(db, { now, limit: 2 }), 0);
  assert.throws(() => pruneExpiredSessions(db, { now: 'not-a-date' }), /invalid/);
  db.close();

  const databaseModuleId = require.resolve('../db/database');
  const originalDatabaseModule = require.cache[databaseModuleId];
  const storeDb = createDatabase();
  require.cache[databaseModuleId] = {
    id: databaseModuleId,
    filename: databaseModuleId,
    loaded: true,
    exports: { getDb: () => storeDb }
  };
  delete require.cache[require.resolve('../lib/sessionStore')];
  const TestStore = require('../lib/sessionStore');

  try {
    insertSession(storeDb, 'abandoned-one', '2026-08-01T00:00:00.000Z');
    insertSession(storeDb, 'abandoned-two', '2026-08-02T00:00:00.000Z');
    const store = new TestStore({
      pruneEveryWrites: 2,
      pruneLimit: 1,
      now: () => now
    });

    await callSet(store, 'current-one', {
      cookie: { expires: new Date('2026-09-02T00:00:00.000Z') },
      userId: 1
    });
    assert.strictEqual(storeDb.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id LIKE 'abandoned-%'").get().count, 2);

    await callSet(store, 'current-two', {
      cookie: { expires: new Date('2026-09-03T00:00:00.000Z') },
      userId: 2
    });
    assert.strictEqual(storeDb.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id LIKE 'abandoned-%'").get().count, 1);
    assert.strictEqual(storeDb.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id LIKE 'current-%'").get().count, 2);

    await callSet(store, 'current-three', {
      cookie: { expires: new Date('2026-09-04T00:00:00.000Z') },
      userId: 3
    });
    assert.strictEqual(storeDb.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id LIKE 'abandoned-%'").get().count, 1);

    await callSet(store, 'current-four', {
      cookie: { expires: new Date('2026-09-05T00:00:00.000Z') },
      userId: 4
    });
    assert.strictEqual(storeDb.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id LIKE 'abandoned-%'").get().count, 0);

    storeDb.prepare('INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)')
      .run('corrupt-json', '{bad', '2026-09-05T00:00:00.000Z');
    storeDb.prepare('INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)')
      .run('invalid-shape', '[]', '2026-09-05T00:00:00.000Z');
    storeDb.prepare('INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)')
      .run('valid-session', JSON.stringify({ userId: 5, cookie: {} }), '2026-09-05T00:00:00.000Z');

    assert.strictEqual(await callGet(store, 'corrupt-json'), null);
    assert.strictEqual(await callGet(store, 'invalid-shape'), null);
    assert.strictEqual(storeDb.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id IN ('corrupt-json', 'invalid-shape')").get().count, 0);
    assert.deepStrictEqual(await callGet(store, 'valid-session'), { userId: 5, cookie: {} });

    console.log('Story 3.37 bounded session retention tests passed');
  } finally {
    storeDb.close();
    if (originalDatabaseModule) require.cache[databaseModuleId] = originalDatabaseModule;
    else delete require.cache[databaseModuleId];
    delete require.cache[require.resolve('../lib/sessionStore')];
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
