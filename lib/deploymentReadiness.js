const path = require('path');
const { parseConfiguredOrigin } = require('./publicAppOrigin');

const EXPECTED_NODE_VERSION = 'v24.20.0';

function present(env, key) {
  return Boolean(String(env[key] || '').trim());
}

function finding(code, severity, message) {
  return Object.freeze({ code, severity, message });
}

function evaluateDeploymentReadiness(env = process.env, { nodeVersion = process.version } = {}) {
  const findings = [];
  const production = env.NODE_ENV === 'production';

  if (!production) findings.push(finding('NODE_ENV_NOT_PRODUCTION', 'blocker', 'NODE_ENV must be production for a release runtime.'));
  if (nodeVersion !== EXPECTED_NODE_VERSION) findings.push(finding('NODE_VERSION_MISMATCH', 'blocker', `Node ${EXPECTED_NODE_VERSION} is required.`));
  if (!present(env, 'SESSION_SECRET')) findings.push(finding('SESSION_SECRET_MISSING', 'blocker', 'A protected session secret is required.'));
  else if (String(env.SESSION_SECRET).trim().length < 32) findings.push(finding('SESSION_SECRET_WEAK', 'blocker', 'The session secret must contain at least 32 characters.'));

  if (!present(env, 'DATABASE_PATH') || !present(env, 'PERSISTENT_DATA_DIR')) {
    findings.push(finding('PERSISTENT_DATABASE_CONFIGURATION_MISSING', 'blocker', 'DATABASE_PATH and PERSISTENT_DATA_DIR must identify durable storage.'));
  } else {
    const databasePath = path.resolve(String(env.DATABASE_PATH).trim());
    const persistentRoot = path.resolve(String(env.PERSISTENT_DATA_DIR).trim());
    const relative = path.relative(persistentRoot, databasePath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      findings.push(finding('DATABASE_OUTSIDE_PERSISTENT_ROOT', 'blocker', 'The database must be a file beneath the persistent data directory.'));
    }
  }

  if (!present(env, 'PUBLIC_APP_ORIGIN')) {
    findings.push(finding('PUBLIC_APP_ORIGIN_MISSING', 'blocker', 'A canonical HTTPS application origin is required.'));
  } else {
    try { parseConfiguredOrigin(env.PUBLIC_APP_ORIGIN, { production: true }); }
    catch (_) { findings.push(finding('PUBLIC_APP_ORIGIN_INVALID', 'blocker', 'The public application origin must be an HTTPS origin without a path.')); }
  }

  for (const key of ['STRIPE_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRO_PRICE', 'STRIPE_UNLIMITED_PRICE']) {
    if (!present(env, key)) findings.push(finding(`${key}_MISSING`, 'blocker', `${key} is required for production billing.`));
  }
  if (present(env, 'STRIPE_KEY') && !/^sk_live_[A-Za-z0-9_]{3,}$/.test(String(env.STRIPE_KEY).trim())) {
    findings.push(finding('STRIPE_KEY_INVALID', 'blocker', 'Production billing requires a live-mode Stripe secret key.'));
  }
  if (present(env, 'STRIPE_WEBHOOK_SECRET') && !/^whsec_[A-Za-z0-9_]{3,255}$/.test(String(env.STRIPE_WEBHOOK_SECRET).trim())) {
    findings.push(finding('STRIPE_WEBHOOK_SECRET_INVALID', 'blocker', 'The Stripe webhook signing secret is invalid.'));
  }
  for (const key of ['STRIPE_PRO_PRICE', 'STRIPE_UNLIMITED_PRICE']) {
    if (present(env, key) && !/^price_[A-Za-z0-9_]{1,249}$/.test(String(env[key]).trim())) {
      findings.push(finding(`${key}_INVALID`, 'blocker', `${key} must be a Stripe price identifier.`));
    }
  }
  if (present(env, 'STRIPE_PRO_PRICE') && String(env.STRIPE_PRO_PRICE).trim() === String(env.STRIPE_UNLIMITED_PRICE || '').trim()) {
    findings.push(finding('STRIPE_PRICE_IDS_NOT_DISTINCT', 'blocker', 'Production plan price identifiers must be distinct.'));
  }
  if (!present(env, 'RESEND_API_KEY')) findings.push(finding('RESEND_API_KEY_MISSING', 'blocker', 'Transactional email delivery must be configured.'));

  const googleFields = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'];
  const googleConfigured = googleFields.filter(key => present(env, key));
  if (googleConfigured.length > 0 && googleConfigured.length !== googleFields.length) {
    findings.push(finding('GOOGLE_OAUTH_PARTIAL_CONFIGURATION', 'blocker', 'Google OAuth must be fully configured or fully disabled.'));
  } else if (googleConfigured.length === googleFields.length) {
    try {
      const callback = new URL(String(env.GOOGLE_CALLBACK_URL).trim());
      if (callback.protocol !== 'https:' || !callback.hostname) throw new Error('invalid');
    } catch (_) {
      findings.push(finding('GOOGLE_CALLBACK_URL_INVALID', 'blocker', 'The production Google OAuth callback must be an absolute HTTPS URL.'));
    }
  }

  const provider = String(env.AI_PROVIDER || 'deterministic').trim().toLowerCase();
  if (!['deterministic', 'openai'].includes(provider)) findings.push(finding('AI_PROVIDER_UNSUPPORTED', 'blocker', 'AI_PROVIDER must be deterministic or openai.'));
  if (provider === 'openai' && !present(env, 'OPENAI_API_KEY')) findings.push(finding('OPENAI_API_KEY_MISSING', 'blocker', 'The selected OpenAI provider requires a protected API key.'));
  if (provider === 'openai' && !present(env, 'AI_SAFETY_IDENTIFIER_SECRET')) findings.push(finding('AI_SAFETY_IDENTIFIER_SECRET_MISSING', 'warning', 'Configure a pseudonymous AI safety identifier secret before live generation.'));

  if (env.OFFSITE_BACKUP_ENABLED !== 'true') findings.push(finding('OFFSITE_BACKUP_DISABLED', 'warning', 'Encrypted off-site backups are not enabled.'));
  if (env.BACKUP_HEALTH_ALERTS_ENABLED !== 'true') findings.push(finding('BACKUP_ALERTS_DISABLED', 'warning', 'Backup health alerts are not enabled.'));
  if (env.STRIPE_RECONCILIATION_ENABLED !== 'true') findings.push(finding('BILLING_RECONCILIATION_DISABLED', 'warning', 'Scheduled billing reconciliation is not enabled.'));

  return Object.freeze({
    ready: findings.every(item => item.severity !== 'blocker'),
    blockerCount: findings.filter(item => item.severity === 'blocker').length,
    warningCount: findings.filter(item => item.severity === 'warning').length,
    findings: Object.freeze(findings)
  });
}

module.exports = { EXPECTED_NODE_VERSION, evaluateDeploymentReadiness };
