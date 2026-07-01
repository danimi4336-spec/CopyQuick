const { getDb } = require('./database');

function initDb() {
  const db = getDb();

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT,
      google_id TEXT UNIQUE,
      avatar_url TEXT,
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

    CREATE TABLE IF NOT EXISTS brand_brain (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      business_name TEXT DEFAULT '',
      industry TEXT DEFAULT '',
      target_audience TEXT DEFAULT '',
      brand_voice TEXT DEFAULT 'professional',
      brand_voice_custom TEXT DEFAULT '',
      unique_value TEXT DEFAULT '',
      competitors TEXT DEFAULT '',
      goals TEXT DEFAULT '',
      tone TEXT DEFAULT 'professional',
      key_messages TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP',
    'generation_type TEXT DEFAULT \'quick\'',
    'brand_voice TEXT DEFAULT \'professional\'',
    'goal TEXT DEFAULT \'\''
  ];

  columns.forEach(col => {
    const colName = col.split(' ')[0];
    try {
      db.exec(`ALTER TABLE generations ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists - ignore
    }
  });

  // Add OAuth columns to users table
  const userCols = ['password_hash TEXT', 'google_id TEXT', 'avatar_url TEXT', 'builder_goal TEXT DEFAULT \'\''];
  userCols.forEach(col => {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists
    }
  });

  // Add brand_brain columns (migration)
  const brainCols = ['brand_voice_custom TEXT DEFAULT \'\''];
  brainCols.forEach(col => {
    try {
      db.exec(`ALTER TABLE brand_brain ADD COLUMN ${col}`);
    } catch (e) {
      // Already exists
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