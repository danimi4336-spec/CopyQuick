const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const projectRoot = path.join(__dirname, '..');
const {
  DatabaseConfigurationError,
  DEFAULT_LOCAL_DATABASE_PATH,
  prepareDatabaseStorage,
  resolveDatabasePath,
  safeStorageDiagnostics
} = require('../lib/databasePath');
const { migrateSqliteStorage } = require('../scripts/migrate-sqlite-storage');

function runNode(source, env) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`Child process failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copyquick-story-3-12-'));
  try {
    assert.strictEqual(resolveDatabasePath({ NODE_ENV: 'development' }), path.resolve(DEFAULT_LOCAL_DATABASE_PATH));
    const explicit = resolveDatabasePath({ NODE_ENV: 'development', DATABASE_PATH: path.join(tempRoot, 'nested', '..', 'explicit.db') });
    assert.strictEqual(explicit, path.join(tempRoot, 'explicit.db'));
    const legacyTestPath = path.join(tempRoot, 'legacy-test.db');
    assert.strictEqual(resolveDatabasePath({ NODE_ENV: 'test', DATABASE_URL: legacyTestPath }), legacyTestPath);

    assert.throws(
      () => resolveDatabasePath({ NODE_ENV: 'production' }),
      (err) => err instanceof DatabaseConfigurationError && err.code === 'PRODUCTION_DATABASE_PATH_REQUIRED'
    );
    assert.throws(
      () => prepareDatabaseStorage({
        NODE_ENV: 'production', DATABASE_PATH: path.join(tempRoot, 'outside.db'),
        PERSISTENT_DATA_DIR: path.join(tempRoot, 'persistent')
      }),
      (err) => err.code === 'PRODUCTION_DATABASE_OUTSIDE_PERSISTENT_ROOT'
    );

    const persistentRoot = path.join(tempRoot, 'persistent');
    fs.mkdirSync(persistentRoot);
    const productionPath = path.join(persistentRoot, 'copyquick.db');
    const validStorage = prepareDatabaseStorage({
      NODE_ENV: 'production', DATABASE_PATH: productionPath, PERSISTENT_DATA_DIR: persistentRoot
    });
    assert.strictEqual(validStorage.databasePath, productionPath);
    assert.strictEqual(validStorage.mode, 'persistent-production');
    assert.strictEqual(validStorage.existedBeforeStartup, false);
    assert.deepStrictEqual(safeStorageDiagnostics(validStorage), {
      mode: 'persistent-production', path: productionPath, writable: true
    });

    assert.throws(
      () => prepareDatabaseStorage({
        NODE_ENV: 'production', DATABASE_PATH: path.join(persistentRoot, 'missing', 'copyquick.db'),
        PERSISTENT_DATA_DIR: persistentRoot
      }),
      (err) => err.code === 'PRODUCTION_DATABASE_DIRECTORY_MISSING'
    );
    const unwritableFs = {
      existsSync: () => true,
      statSync: () => ({ isDirectory: () => true }),
      accessSync: () => { throw new Error('read-only'); }
    };
    assert.throws(
      () => prepareDatabaseStorage({
        NODE_ENV: 'production', DATABASE_PATH: productionPath, PERSISTENT_DATA_DIR: persistentRoot
      }, unwritableFs),
      (err) => err.code === 'PRODUCTION_DATABASE_DIRECTORY_NOT_WRITABLE'
    );

    const initOutput = runNode(
      "const {initDb}=require('./db/init'); const {getDb}=require('./db/database'); initDb(); const db=getDb(); db.prepare(\"INSERT INTO users(email,name) VALUES('durable@example.com','Durable')\").run(); console.log(db.pragma('journal_mode',{simple:true}));",
      { NODE_ENV: 'development', DATABASE_PATH: productionPath, DATABASE_URL: path.join(tempRoot, 'ignored.db') }
    );
    assert.match(initOutput, /wal/i);
    assert(fs.existsSync(productionPath));
    assert(!fs.existsSync(path.join(tempRoot, 'ignored.db')), 'DATABASE_PATH must be authoritative');
    const schemaDb = new Database(productionPath, { readonly: true, fileMustExist: true });
    assert.strictEqual(schemaDb.pragma('quick_check', { simple: true }), 'ok');
    ['sessions', 'production_runs', 'production_jobs', 'production_job_events', 'usage_events'].forEach(function(table) {
      assert(schemaDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
    });
    schemaDb.close();

    runNode("const {initDb}=require('./db/init'); initDb();", { NODE_ENV: 'development', DATABASE_PATH: productionPath });
    const reusedDb = new Database(productionPath, { readonly: true, fileMustExist: true });
    assert.strictEqual(reusedDb.prepare("SELECT COUNT(*) AS count FROM users WHERE email='durable@example.com'").get().count, 1,
      'existing target must not be reset');
    reusedDb.close();

    runNode(
      "const {initDb}=require('./db/init'); const Store=require('./lib/sessionStore'); const {getDb}=require('./db/database'); initDb(); new Store().set('durable-session',{cookie:{}},err=>{if(err)throw err; console.log(getDb().prepare(\"SELECT COUNT(*) AS count FROM sessions WHERE id='durable-session'\").get().count);});",
      { NODE_ENV: 'development', DATABASE_PATH: productionPath }
    );
    const sessionDb = new Database(productionPath, { readonly: true, fileMustExist: true });
    assert.strictEqual(sessionDb.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id='durable-session'").get().count, 1);
    sessionDb.close();

    const sourcePath = path.join(tempRoot, 'migration-source.db');
    const destinationPath = path.join(tempRoot, 'migration-destination.db');
    const sourceDb = new Database(sourcePath);
    sourceDb.pragma('journal_mode = WAL');
    sourceDb.exec('CREATE TABLE durable_rows (id INTEGER PRIMARY KEY, value TEXT);');
    sourceDb.prepare('INSERT INTO durable_rows(value) VALUES (?)').run('preserved');
    sourceDb.close();
    const migrated = await migrateSqliteStorage({ sourcePath, destinationPath });
    assert.strictEqual(migrated.integrity, 'ok');
    assert.strictEqual(migrated.tableCounts.durable_rows, 1);
    const migratedDb = new Database(destinationPath, { readonly: true, fileMustExist: true });
    assert.strictEqual(migratedDb.prepare('SELECT value FROM durable_rows').get().value, 'preserved');
    assert.strictEqual(migratedDb.pragma('quick_check', { simple: true }), 'ok');
    migratedDb.close();
    await assert.rejects(
      migrateSqliteStorage({ sourcePath: path.join(tempRoot, 'missing-source.db'), destinationPath: path.join(tempRoot, 'unused.db') }),
      /Source database does not exist/
    );
    await assert.rejects(
      migrateSqliteStorage({ sourcePath, destinationPath }),
      /Destination already exists/
    );

    const restartPath = path.join(tempRoot, 'restart.db');
    runNode(`
      const {initDb}=require('./db/init'); const {getDb}=require('./db/database'); initDb(); const db=getDb();
      const user=Number(db.prepare("INSERT INTO users(email,name,plan_tier,monthly_limit,generations_used,current_period_used) VALUES('restart@example.com','Restart','pro',10,1,1)").run().lastInsertRowid);
      const period=Number(db.prepare("INSERT INTO usage_periods(user_id,period_start,period_end,plan_tier,monthly_limit,usage_count) VALUES(?,'2026-08-01','2026-09-01','pro',10,1)").run(user).lastInsertRowid);
      db.prepare('UPDATE users SET current_usage_period_id=? WHERE id=?').run(period,user);
      const run=Number(db.prepare("INSERT INTO production_runs(user_id,objective,status,plan_fingerprint,idempotency_key,approved_at,started_at,strategy_snapshot,production_cost_units,usage_period_id) VALUES(?,'launch_product','queued','durable-plan','durable-key',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{}',1,?)").run(user,period).lastInsertRowid);
      const job=Number(db.prepare("INSERT INTO production_jobs(production_run_id,deliverable_id,title,phase,sequence_order,status,strategic_direction,strategy_snapshot,dependencies,contract_version) VALUES(?,'customer_profile','Customer Profile','foundation',0,'running','Approved direction','{}','[]','customer_profile:v1')").run(run).lastInsertRowid);
      db.prepare("UPDATE production_jobs SET claim_token='expired',claimed_at=datetime('now','-10 minutes'),lease_expires_at=datetime('now','-5 minutes'),provider_started_at=NULL WHERE id=?").run(job);
      db.prepare("INSERT INTO usage_events(user_id,usage_period_id,production_run_id,event_type,units,source_route) VALUES(?,?,?,'production_start',1,'test')").run(user,period,run);
      console.log(run);
    `, { NODE_ENV: 'development', DATABASE_PATH: restartPath });

    const resumeOutput = runNode(`
      const {initDb}=require('./db/init'); const {getDb}=require('./db/database'); const {runOrchestratorCycle}=require('./lib/productionOrchestrator'); initDb(); const db=getDb();
      runOrchestratorCycle({db,generatorApi:{generateCopy:()=>[{text:'Restart-safe output',tone:'professional'}]},concurrency:1}).then(result=>{
        const run=db.prepare("SELECT * FROM production_runs WHERE idempotency_key='durable-key'").get();
        const job=db.prepare('SELECT * FROM production_jobs WHERE production_run_id=?').get(run.id);
        console.log(JSON.stringify({work:result.workPerformed,status:job.status,generations:db.prepare('SELECT COUNT(*) AS count FROM generations WHERE production_job_id=?').get(job.id).count,usage:db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE production_run_id=?').get(run.id).count}));
      });
    `, { NODE_ENV: 'development', DATABASE_PATH: restartPath });
    assert.match(resumeOutput, /"work":1/);
    assert.match(resumeOutput, /"status":"completed"/);
    assert.match(resumeOutput, /"generations":1/);
    assert.match(resumeOutput, /"usage":1/);

    const secondRestart = runNode(`
      const {initDb}=require('./db/init'); const {getDb}=require('./db/database'); const {runOrchestratorCycle}=require('./lib/productionOrchestrator'); initDb(); const db=getDb();
      runOrchestratorCycle({db,generatorApi:{generateCopy:()=>{throw new Error('completed job reran');}},concurrency:1}).then(result=>{
        const run=db.prepare("SELECT * FROM production_runs WHERE idempotency_key='durable-key'").get();
        const job=db.prepare('SELECT * FROM production_jobs WHERE production_run_id=?').get(run.id);
        console.log(JSON.stringify({work:result.workPerformed,generations:db.prepare('SELECT COUNT(*) AS count FROM generations WHERE production_job_id=?').get(job.id).count,usage:db.prepare('SELECT COUNT(*) AS count FROM usage_events WHERE production_run_id=?').get(run.id).count}));
      });
    `, { NODE_ENV: 'development', DATABASE_PATH: restartPath });
    assert.match(secondRestart, /"work":0/);
    assert.match(secondRestart, /"generations":1/);
    assert.match(secondRestart, /"usage":1/);

    const envExample = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
    assert.match(envExample, /DATABASE_PATH=/);
    assert.match(envExample, /PERSISTENT_DATA_DIR=\/var\/data/);
    assert.doesNotMatch(envExample, /sk_live_|whsec_[A-Za-z0-9]{20,}/);
    const renderBlueprint = fs.readFileSync(path.join(projectRoot, 'render.yaml'), 'utf8');
    assert.match(renderBlueprint, /plan: starter/);
    assert.doesNotMatch(renderBlueprint, /type:\s*worker|redis/i);
    const runbook = fs.readFileSync(path.join(projectRoot, 'docs', 'DURABLE_STORAGE_RUNBOOK.md'), 'utf8');
    assert.match(runbook, /\/var\/data\/copyquick\.db/);
    assert.match(runbook, /5 GB/);
    assert.match(runbook, /Do not horizontally scale/);

    console.log('Story 3.12 Durable Production Storage tests passed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
