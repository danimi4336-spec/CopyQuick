const SAFE_CONDITION = /^[A-Z0-9_]{1,64}$/;

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function safeText(value, maximum = 500) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum);
}

function createOperatorNotifier({ env = process.env, resendClient } = {}) {
  const candidate = typeof env.BACKUP_ALERT_EMAIL === 'string' ? env.BACKUP_ALERT_EMAIL.trim() : '';
  const recipient = candidate.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : '';
  let client = resendClient || null;
  if (!client && env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    client = new Resend(env.RESEND_API_KEY);
  }

  async function send({ condition, kind, observedAt }) {
    if (!client || !recipient) return { sent: false, code: !recipient ? 'BACKUP_ALERT_RECIPIENT_REQUIRED' : 'BACKUP_ALERT_EMAIL_UNAVAILABLE' };
    const conditionId = SAFE_CONDITION.test(condition?.id || '') ? condition.id : 'BACKUP_HEALTH_CONDITION';
    const severity = condition?.severity === 'critical' ? 'critical' : 'warning';
    const notificationKind = ['alert', 'escalation', 'reminder', 'recovery'].includes(kind) ? kind : 'alert';
    const description = safeText(condition?.description);
    const action = safeText(condition?.suggestedAction);
    const environment = safeText(env.NODE_ENV || 'unknown', 32);
    const firstObservedAt = safeText(condition?.firstObservedAt || observedAt, 32);
    const currentObservedAt = safeText(observedAt, 32);
    const subject = `[CopyQuick ${notificationKind === 'recovery' ? 'Recovered' : severity.toUpperCase()}] ${conditionId}`;
    const text = [
      `CopyQuick environment: ${environment}`,
      `Condition: ${conditionId}`,
      `Notification: ${notificationKind}`,
      `Severity: ${severity}`,
      `First observed: ${firstObservedAt}`,
      `Observed: ${currentObservedAt}`,
      `Status: ${description}`,
      `Suggested action: ${action}`
    ].join('\n');
    const html = `<h1>CopyQuick operational ${escapeHtml(notificationKind)}</h1>` +
      `<p><strong>Environment:</strong> ${escapeHtml(environment)}</p>` +
      `<p><strong>Condition:</strong> ${escapeHtml(conditionId)}</p>` +
      `<p><strong>Severity:</strong> ${escapeHtml(severity)}</p>` +
      `<p><strong>First observed:</strong> ${escapeHtml(firstObservedAt)}</p>` +
      `<p><strong>Observed:</strong> ${escapeHtml(currentObservedAt)}</p>` +
      `<p>${escapeHtml(description)}</p><p><strong>Suggested action:</strong> ${escapeHtml(action)}</p>`;
    try {
      const result = await client.emails.send({
        from: 'CopyQuick Operations <support@copyquick.co>',
        to: [recipient], subject, text, html
      });
      if (result?.error) return { sent: false, code: 'BACKUP_ALERT_EMAIL_FAILED' };
      return { sent: true };
    } catch (_) {
      return { sent: false, code: 'BACKUP_ALERT_EMAIL_FAILED' };
    }
  }

  return { send, ready: Boolean(client && recipient) };
}

module.exports = { createOperatorNotifier, safeText };
