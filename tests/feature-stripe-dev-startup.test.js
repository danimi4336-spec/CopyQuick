const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.join(__dirname, '..');

function runNode(args, env = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Child process timed out.\n${stdout}\n${stderr}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function startDevelopmentServer(databasePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        STRIPE_KEY: '',
        DATABASE_URL: databasePath,
        SESSION_SECRET: 'feature-stripe-dev-session-secret',
        PORT: '0'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Development server did not start.\n${output}`));
    }, 8000);

    function inspect(chunk) {
      output += chunk;
      if (output.includes('Server is running')) {
        clearTimeout(timer);
        child.kill('SIGTERM');
        child.once('exit', () => resolve(output));
      }
    }

    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!output.includes('Server is running')) {
        clearTimeout(timer);
        reject(new Error(`Development server exited before startup (${code}).\n${output}`));
      }
    });
  });
}

async function run() {
  const databasePath = path.join('/tmp', `copyquick-stripe-dev-${process.pid}.sqlite`);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(databasePath + suffix); } catch (err) { /* absent is expected */ }
  }

  try {
    const migration = await runNode(['scripts/migrate-database.js'], {
      NODE_ENV: 'development',
      DATABASE_URL: databasePath,
      SESSION_SECRET: 'feature-stripe-dev-session-secret'
    });
    assert.strictEqual(migration.code, 0, migration.stderr);

    const developmentOutput = await startDevelopmentServer(databasePath);
    assert.match(developmentOutput, /⚠️ Stripe billing disabled\./);
    assert.match(developmentOutput, /Local development mode\./);
    assert.match(developmentOutput, /Billing routes unavailable until STRIPE_KEY is configured\./);

    const disabledCall = await runNode([
      '-e',
      "const billing=require('./lib/stripe'); billing.createCheckoutSession().catch(err => { console.log(err.code); process.exit(err.code === 'BILLING_DISABLED' ? 0 : 1); });"
    ], { NODE_ENV: 'development', STRIPE_KEY: '' });
    assert.strictEqual(disabledCall.code, 0);
    assert.match(disabledCall.stdout, /BILLING_DISABLED/);

    const configured = await runNode([
      '-e',
      "const billing=require('./lib/stripe'); console.log(billing.isBillingEnabled, Boolean(billing.stripe));"
    ], { NODE_ENV: 'development', STRIPE_KEY: 'sk_test_feature_startup' });
    assert.strictEqual(configured.code, 0);
    assert.match(configured.stdout, /true true/);

    const production = await runNode(['server.js'], {
      NODE_ENV: 'production',
      STRIPE_KEY: '',
      DATABASE_PATH: databasePath,
      PERSISTENT_DATA_DIR: '/tmp',
      SESSION_SECRET: 'feature-stripe-prod-session-secret',
      PORT: '0'
    });
    assert.notStrictEqual(production.code, 0);
    assert.match(production.stderr, /STRIPE_KEY is required when NODE_ENV=production/);

    console.log('Graceful Stripe development startup tests passed');
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(databasePath + suffix); } catch (err) { /* absent is expected */ }
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
