const { getDb } = require('./database');

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      plan_tier TEXT DEFAULT 'free',
      generations_used INTEGER DEFAULT 0,
      monthly_limit INTEGER DEFAULT 10,
      stripe_customer_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      input_text TEXT NOT NULL,
      content_type TEXT NOT NULL,
      tone TEXT DEFAULT 'professional',
      results TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at DATETIME NOT NULL
    );
  `);

  console.log('Database initialized successfully.');
}

if (require.main === module) {
  initDb();
}

module.exports = { initDb };
