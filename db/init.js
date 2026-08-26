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

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      stripe_customer_id TEXT NOT NULL,
      stripe_subscription_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL,
      plan_tier TEXT NOT NULL,
      price_id TEXT,
      current_period_start DATETIME NOT NULL,
      current_period_end DATETIME NOT NULL,
      cancel_at_period_end INTEGER DEFAULT 0,
      canceled_at DATETIME,
      ended_at DATETIME,
      latest_stripe_event_created INTEGER DEFAULT 0,
      latest_stripe_event_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      stripe_created INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'processed',
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usage_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      subscription_id INTEGER REFERENCES subscriptions(id),
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      plan_tier TEXT NOT NULL,
      monthly_limit INTEGER NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, period_start, period_end)
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      usage_period_id INTEGER REFERENCES usage_periods(id),
      generation_id INTEGER REFERENCES generations(id),
      event_type TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 1,
      source_route TEXT DEFAULT '',
      metadata TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'awaiting_start',
      plan_fingerprint TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      approved_at DATETIME NOT NULL,
      started_at DATETIME,
      completed_at DATETIME,
      failed_at DATETIME,
      last_scheduled_at DATETIME,
      strategy_snapshot TEXT NOT NULL,
      production_cost_units INTEGER NOT NULL,
      usage_period_id INTEGER REFERENCES usage_periods(id),
      usage_event_id INTEGER REFERENCES usage_events(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS production_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_run_id INTEGER NOT NULL REFERENCES production_runs(id),
      deliverable_id TEXT NOT NULL,
      title TEXT NOT NULL,
      phase TEXT NOT NULL,
      phase_title TEXT DEFAULT '',
      sequence_order INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      strategic_direction TEXT NOT NULL,
      strategy_snapshot TEXT NOT NULL,
      dependencies TEXT NOT NULL DEFAULT '[]',
      generation_type TEXT,
      generation_id INTEGER REFERENCES generations(id),
      error_message TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      last_error_code TEXT,
      reversal_usage_event_id INTEGER REFERENCES usage_events(id),
      started_at DATETIME,
      completed_at DATETIME,
      failed_at DATETIME,
      claimed_at DATETIME,
      lease_expires_at DATETIME,
      claim_token TEXT,
      provider_started_at DATETIME,
      contract_version TEXT,
      recovery_reason TEXT,
      next_attempt_at DATETIME,
      last_attempt_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(production_run_id, deliverable_id)
    );

    CREATE TABLE IF NOT EXISTS production_job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_run_id INTEGER NOT NULL REFERENCES production_runs(id),
      production_job_id INTEGER NOT NULL REFERENCES production_jobs(id),
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      attempt_number INTEGER NOT NULL DEFAULT 0,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    'goal TEXT DEFAULT \'\'',
    'production_job_id INTEGER REFERENCES production_jobs(id)',
    'deliverable_id TEXT',
    'contract_version TEXT',
    'structured_result TEXT'
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
  const userCols = [
    'password_hash TEXT',
    'google_id TEXT',
    'avatar_url TEXT',
    'builder_goal TEXT DEFAULT \'\'',
    'current_usage_period_id INTEGER REFERENCES usage_periods(id)',
    'current_period_used INTEGER DEFAULT 0',
    'usage_tracking_version TEXT DEFAULT \'legacy\'',
    'quota_enforcement_mode TEXT DEFAULT \'legacy\''
  ];
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

  // Add subscription ordering columns (migration)
  const subscriptionCols = [
    'latest_stripe_event_created INTEGER DEFAULT 0',
    'latest_stripe_event_id TEXT'
  ];
  subscriptionCols.forEach(col => {
    try {
      db.exec(`ALTER TABLE subscriptions ADD COLUMN ${col}`);
    } catch (e) {
      // Already exists
    }
  });

  try {
    db.exec('ALTER TABLE usage_events ADD COLUMN production_run_id INTEGER REFERENCES production_runs(id)');
  } catch (e) {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE usage_events ADD COLUMN production_job_id INTEGER REFERENCES production_jobs(id)');
  } catch (e) {
    // Column already exists
  }

  const productionJobCols = [
    'attempt_count INTEGER NOT NULL DEFAULT 0',
    'max_attempts INTEGER NOT NULL DEFAULT 3',
    'last_error_code TEXT',
    'reversal_usage_event_id INTEGER REFERENCES usage_events(id)',
    'failed_at DATETIME',
    'claimed_at DATETIME',
    'lease_expires_at DATETIME',
    'claim_token TEXT',
    'provider_started_at DATETIME',
    'contract_version TEXT',
    'recovery_reason TEXT',
    'next_attempt_at DATETIME',
    'last_attempt_at DATETIME'
  ];
  productionJobCols.forEach(function(col) {
    try {
      db.exec(`ALTER TABLE production_jobs ADD COLUMN ${col}`);
    } catch (e) {
      // Column already exists
    }
  });

  try {
    db.exec('ALTER TABLE production_runs ADD COLUMN last_scheduled_at DATETIME');
  } catch (e) {
    // Column already exists
  }

  // Create indexes for performance
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_user_id ON generations(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_favorite ON generations(user_id, favorite)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_deleted ON generations(user_id, is_deleted)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_type ON generations(user_id, content_type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_generations_created ON generations(user_id, created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_id ON subscriptions(stripe_customer_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type ON stripe_webhook_events(event_type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_created ON stripe_webhook_events(stripe_created)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_periods_user_period_end ON usage_periods(user_id, period_end)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_periods_subscription_id ON usage_periods(subscription_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_events_user_created ON usage_events(user_id, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_events_period_id ON usage_events(usage_period_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_events_generation_id ON usage_events(generation_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_events_user_type ON usage_events(user_id, event_type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_events_production_run_id ON usage_events(production_run_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_events_production_job_id ON usage_events(production_job_id)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_job_reversal ON usage_events(production_job_id, event_type) WHERE event_type = 'production_reversal'`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_runs_user_created ON production_runs(user_id, created_at DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_runs_user_fingerprint ON production_runs(user_id, plan_fingerprint)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_jobs_run_order ON production_jobs(production_run_id, sequence_order)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_jobs_run_status ON production_jobs(production_run_id, status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_jobs_expired_lease ON production_jobs(status, lease_expires_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_jobs_runnable_at ON production_jobs(status, next_attempt_at, production_run_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_runs_schedule ON production_runs(status, last_scheduled_at, created_at)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_job_events_job_created ON production_job_events(production_job_id, created_at)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_generations_production_job ON generations(production_job_id) WHERE production_job_id IS NOT NULL`);
  } catch (e) {
    // Index already exists
  }

  const integrity = db.pragma('quick_check', { simple: true });
  if (integrity !== 'ok') throw new Error('SQLite integrity validation failed.');

  console.log('Database initialized successfully.');
  return { integrity };
}

if (require.main === module) {
  initDb();
  console.log('Migration complete.');
}

module.exports = { initDb };
