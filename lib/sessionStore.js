const session = require('express-session');
const { getDb } = require('../db/database');

class SQLiteStore extends session.Store {
  constructor() {
    super();
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
      cb(null, { userId: sess.user_id });
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    const db = getDb();
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      // Only store if userId is present
      if (sess.userId) {
        db.prepare('INSERT OR REPLACE INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
          .run(sid, sess.userId, expiresAt);
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
