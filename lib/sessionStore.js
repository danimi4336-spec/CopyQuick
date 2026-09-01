const session = require('express-session');
const { getDb } = require('../db/database');

const DEFAULT_PRUNE_EVERY_WRITES = 100;
const DEFAULT_PRUNE_LIMIT = 250;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pruneExpiredSessions(db, options = {}) {
  const limit = positiveInteger(options.limit, DEFAULT_PRUNE_LIMIT);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error('Session cleanup time is invalid.');

  return db.prepare(`
    DELETE FROM sessions
    WHERE id IN (
      SELECT id
      FROM sessions
      WHERE datetime(expires_at) <= datetime(?)
      ORDER BY expires_at ASC, id ASC
      LIMIT ?
    )
  `).run(now.toISOString(), limit).changes;
}

class SQLiteStore extends session.Store {
  constructor(options = {}) {
    super();
    this.pruneEveryWrites = positiveInteger(options.pruneEveryWrites, DEFAULT_PRUNE_EVERY_WRITES);
    this.pruneLimit = positiveInteger(options.pruneLimit, DEFAULT_PRUNE_LIMIT);
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
    this.writesUntilPrune = this.pruneEveryWrites;
  }

  get(sid, cb) {
    const db = getDb();
    try {
      const sess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid);
      if (!sess) return cb(null, null);
      if (new Date(sess.expires_at) < new Date()) {
        this.destroy(sid, cb);
        return;
      }
      cb(null, JSON.parse(sess.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    const db = getDb();
    try {
      const expiresAt = (sess.cookie && sess.cookie.expires) 
        ? new Date(sess.cookie.expires).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      
      db.prepare('INSERT OR REPLACE INTO sessions (id, data, expires_at) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(sess), expiresAt);

      this.writesUntilPrune -= 1;
      if (this.writesUntilPrune <= 0) {
        this.writesUntilPrune = this.pruneEveryWrites;
        try {
          pruneExpiredSessions(db, { limit: this.pruneLimit, now: this.now() });
        } catch (cleanupErr) {
          // The authenticated session write succeeded. Retention cleanup is
          // best-effort and must not turn a valid request into a logout.
          console.warn('Expired session cleanup failed.');
        }
      }
      
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    const db = getDb();
    try {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      if (cb) cb(null);
    } catch (err) {
      if (cb) cb(err);
    }
  }
}

module.exports = SQLiteStore;
module.exports.DEFAULT_PRUNE_EVERY_WRITES = DEFAULT_PRUNE_EVERY_WRITES;
module.exports.DEFAULT_PRUNE_LIMIT = DEFAULT_PRUNE_LIMIT;
module.exports.pruneExpiredSessions = pruneExpiredSessions;
