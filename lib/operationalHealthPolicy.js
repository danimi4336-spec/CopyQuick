const CONDITION_DETAILS = {
  BILLING_RECONCILIATION_FAILED: {
    severity: 'critical',
    description: 'The latest Stripe reconciliation did not complete successfully.',
    action: 'Inspect billing status and sanitized reconciliation logs before retrying.'
  },
  BILLING_ENTITLEMENT_DRIFT_UNRESOLVED: {
    severity: 'critical',
    description: 'Stripe reconciliation found entitlement drift that was not safely repaired.',
    action: 'Run a reviewed dry run and resolve every unsupported or ambiguous billing issue.'
  },
  BILLING_RECONCILIATION_NEVER_SUCCEEDED: {
    severity: 'warning',
    description: 'Automated Stripe reconciliation is enabled but has not completed successfully.',
    action: 'Inspect scheduler status and complete an approved reconciliation run.'
  },
  BILLING_DRIFT_DETECTED: {
    severity: 'warning',
    description: 'A Stripe reconciliation dry run detected local billing drift.',
    action: 'Review every proposed correction before an explicit apply run.'
  },
  PRODUCTION_RECOVERY_REQUIRED: {
    severity: 'critical',
    description: 'One or more Production jobs have an ambiguous provider outcome requiring safe review.',
    action: 'Use the Production recovery status and offline verified recovery runbook.'
  }
};

function condition(id, fingerprint) {
  const detail = CONDITION_DETAILS[id];
  return {
    id,
    severity: detail.severity,
    description: detail.description,
    suggestedAction: detail.action,
    evidenceFingerprint: String(fingerprint || id).slice(0, 256)
  };
}

function evaluateOperationalHealth(health = {}) {
  const conditions = [];
  const billing = health.billing || {};
  if (billing.enabled) {
    if (billing.lastFailureCode) {
      conditions.push(condition('BILLING_RECONCILIATION_FAILED', `${billing.lastRunAt || 'unknown'}:${billing.lastFailureCode}`));
    }
    if (Number(billing.unresolvedCount) > 0) {
      conditions.push(condition('BILLING_ENTITLEMENT_DRIFT_UNRESOLVED', `${billing.lastRunAt || 'unknown'}:${billing.unresolvedCount}`));
    }
    if (!billing.lastSuccessAt && !billing.lastFailureCode) {
      conditions.push(condition('BILLING_RECONCILIATION_NEVER_SUCCEEDED', billing.lastRunAt || 'never'));
    }
    if (billing.lastMode === 'dry_run' && Number(billing.driftCount) > 0 && Number(billing.unresolvedCount) === 0) {
      conditions.push(condition('BILLING_DRIFT_DETECTED', `${billing.lastRunAt || 'unknown'}:${billing.driftCount}`));
    }
  }
  const recovery = health.productionRecovery || {};
  if (Number(recovery.recoveryRequiredCount) > 0) {
    const oldest = recovery.issues?.[0];
    conditions.push(condition('PRODUCTION_RECOVERY_REQUIRED', `${oldest?.runId || 0}:${oldest?.jobId || 0}:${recovery.recoveryRequiredCount}`));
  }
  return conditions;
}

module.exports = { CONDITION_DETAILS, evaluateOperationalHealth };
