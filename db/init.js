const { getDb } = require('./database');

function initDb() {
  const db = getDb();

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

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
      title TEXT DEFAULT '',
      input_text TEXT NOT NULL,
      content_type TEXT NOT NULL,
      tone TEXT DEFAULT 'professional',
      ai_model TEXT DEFAULT 'CopyQuick AI',
      language TEXT DEFAULT 'English',
      results TEXT NOT NULL,
      word_count INTEGER DEFAULT 0,
      favorite INTEGER DEFAULT 0,
      tags TEXT DEFAULT '',
      is_deleted INTEGER DEFAULT 0,
      deleted_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at DATETIME NOT NULL
    );
  `);

  // Add new columns to existing table if they don't exist (for older databases)
  const columns = [
    'title TEXT DEFAULT \'\'',
    'ai_model TEXT DEFAULT \'CopyQuick AI\'',
    'language TEXT DEFAULT \'English\'',
    'word_count INTEGER DEFAULT 0',
    'favorite INTEGER DEFAULT 0',
    'tags TEXT DEFAULT \'\'',
    'is_deleted INTEGER DEFAULT 0',
    'deleted_at DATETIME',
    'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'
  ];

  columns.forEach(col => {
    const colName = col.split(' ')[0];
    try {
      db.exec(`ALTER TABLE generations ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists - ignore
    }
  });

  // Create indexes for performance
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_favorite ON generations(user_id, favorite)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_deleted ON generations(user_id, is_deleted)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_type ON generations(user_id, content_type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(user_id, created_at DESC)`);
  } catch (e) {
    // Index already exists
  }

  console.log('Database initialized successfully.');
}

if (require.main === module) {
  initDb();
  console.log('Migration complete.');
}

module.exports = { initDb };