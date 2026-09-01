const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { writeOperationalEvent } = require('./operationalLogger');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
let resend = null;

if (RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(RESEND_API_KEY);
} else {
  console.log('⚠️ RESEND_API_KEY not configured — email sending disabled.');
}

const DEFAULT_EMAIL_MAX_ATTEMPTS = 3;
const DEFAULT_EMAIL_RETRY_BASE_MS = 250;
const DEFAULT_EMAIL_ATTEMPT_TIMEOUT_MS = 10 * 1000;
const DEFAULT_EMAIL_TOTAL_TIMEOUT_MS = 35 * 1000;
const MAX_EMAIL_ATTEMPTS = 5;
const MAX_EMAIL_RETRY_BASE_MS = 10 * 1000;
const MAX_EMAIL_ATTEMPT_TIMEOUT_MS = 60 * 1000;
const MAX_EMAIL_TOTAL_TIMEOUT_MS = 60 * 1000;
const DEFAULT_CONTACT_TOTAL_TIMEOUT_MS = 40 * 1000;
const MAX_CONTACT_TOTAL_TIMEOUT_MS = 60 * 1000;

class EmailDeliveryError extends Error {
  constructor(code) {
    super('Transactional email could not be delivered safely.');
    this.name = 'EmailDeliveryError';
    this.code = code;
  }
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function contactTotalTimeoutMs(value = process.env.CONTACT_EMAIL_TOTAL_TIMEOUT_MS) {
  return boundedPositiveInteger(value, DEFAULT_CONTACT_TOTAL_TIMEOUT_MS, MAX_CONTACT_TOTAL_TIMEOUT_MS);
}

function normalizedEmailFailure(error) {
  const statusCode = Number(error?.statusCode || error?.status);
  const name = String(error?.name || error?.code || '').toLowerCase();
  if (statusCode === 429 || name.includes('rate_limit') || name.includes('concurrent_idempotent')) {
    return { code: 'EMAIL_RATE_LIMITED', retryable: true };
  }
  if (statusCode >= 500 || !Number.isInteger(statusCode) || name.includes('application_error') || name.includes('internal_server')) {
    return { code: 'EMAIL_PROVIDER_UNAVAILABLE', retryable: true };
  }
  return { code: 'EMAIL_PROVIDER_REJECTED', retryable: false };
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function sendEmailWithRetry({
  client,
  payload,
  idempotencyKey,
  operation,
  maxAttempts = process.env.EMAIL_DELIVERY_MAX_ATTEMPTS,
  retryBaseMs = process.env.EMAIL_DELIVERY_RETRY_BASE_MS,
  attemptTimeoutMs = process.env.EMAIL_DELIVERY_TIMEOUT_MS,
  totalTimeoutMs = process.env.EMAIL_DELIVERY_TOTAL_TIMEOUT_MS,
  sleep = wait,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  now = Date.now,
  logger = writeOperationalEvent
}) {
  if (!client) throw new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE');
  const attempts = boundedPositiveInteger(maxAttempts, DEFAULT_EMAIL_MAX_ATTEMPTS, MAX_EMAIL_ATTEMPTS);
  const baseMs = boundedPositiveInteger(retryBaseMs, DEFAULT_EMAIL_RETRY_BASE_MS, MAX_EMAIL_RETRY_BASE_MS);
  const timeoutMs = boundedPositiveInteger(attemptTimeoutMs, DEFAULT_EMAIL_ATTEMPT_TIMEOUT_MS, MAX_EMAIL_ATTEMPT_TIMEOUT_MS);
  const totalMs = boundedPositiveInteger(totalTimeoutMs, DEFAULT_EMAIL_TOTAL_TIMEOUT_MS, MAX_EMAIL_TOTAL_TIMEOUT_MS);
  const startedAt = now();
  let failure = { code: 'EMAIL_DELIVERY_FAILED', retryable: false };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const remainingMs = totalMs - Math.max(0, now() - startedAt);
    if (remainingMs <= 0) break;
    let timeout;
    try {
      const invocation = Promise.resolve().then(() => client.emails.send(payload, { idempotencyKey }));
      const timeoutFailure = new Promise((_, reject) => {
        timeout = setTimeoutFn(() => {
          const error = new Error('Transactional email attempt timed out.');
          error.code = 'ETIMEDOUT';
          reject(error);
        }, Math.min(timeoutMs, remainingMs));
      });
      const result = await Promise.race([invocation, timeoutFailure]);
      if (!result?.error && typeof result?.data?.id === 'string' && result.data.id.length > 0) {
        logger({ event: 'email_delivery_completed', operation });
        return { delivered: true, providerId: result.data.id, attemptCount: attempt };
      }
      failure = result?.error
        ? normalizedEmailFailure(result.error)
        : { code: 'EMAIL_PROVIDER_UNAVAILABLE', retryable: true };
    } catch (error) {
      failure = normalizedEmailFailure(error);
    } finally {
      clearTimeoutFn(timeout);
    }
    if (!failure.retryable || attempt >= attempts) break;
    const delayMs = baseMs * (2 ** (attempt - 1));
    const remainingAfterAttemptMs = totalMs - Math.max(0, now() - startedAt);
    if (delayMs >= remainingAfterAttemptMs) break;
    await sleep(delayMs);
  }
  logger({ event: 'email_delivery_failed', operation, code: failure.code });
  throw new EmailDeliveryError(failure.code);
}

// Generate ticket number: CQ-YYYYMMDD-#####
function generateTicketNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 99999) + 1).padStart(5, '0');
  return `CQ-${y}${m}${d}-${seq}`;
}

// Format date in America/New_York timezone
function formatDate(date) {
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }) + ' ET';
}

// Escape HTML to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function sanitizeHeaderValue(value) {
  return String(value || '').replace(/[\r\n]/g, ' ').trim();
}

// Shared email wrapper
function emailWrapper(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CopyQuick</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <!-- Logo -->
          <tr>
            <td style="padding-bottom:24px;text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="background:#4f46e5;border-radius:8px;padding:8px 20px;">
                    <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.5px;">CopyQuick</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${content}
          <!-- Footer -->
          <tr>
            <td style="padding-top:32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;padding-top:24px;">
                <tr>
                  <td style="text-align:center;padding-bottom:8px;">
                    <a href="https://copyquick.co" style="color:#4f46e5;text-decoration:none;font-size:14px;font-weight:600;">copyquick.co</a>
                    <span style="color:#94a3b8;margin:0 8px;">·</span>
                    <a href="mailto:support@copyquick.co" style="color:#4f46e5;text-decoration:none;font-size:14px;font-weight:600;">support@copyquick.co</a>
                  </td>
                </tr>
                <tr>
                  <td style="text-align:center;color:#94a3b8;font-size:12px;line-height:1.6;">
                    © 2026 CopyQuick. All rights reserved.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Card component
function card(content) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;">
    <tr><td style="padding:24px;">${content}</td></tr>
  </table>`;
}

// Field row
function fieldRow(label, value) {
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="140" style="font-size:13px;font-weight:600;color:#64748b;vertical-align:top;padding:4px 8px 4px 0;">${label}</td>
          <td style="font-size:14px;color:#1f2937;vertical-align:top;padding:4px 0;">${value}</td>
        </tr>
      </table>
    </td>
  </tr>`;
}

// ====== Admin Notification ======
function buildAdminEmail({ ticketNumber, name, email, subject, message, ip, userAgent, submittedAt }) {
  const body = card(`
    <div style="margin-bottom:16px;">
      <span style="display:inline-block;background:#4f46e5;color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;padding:3px 10px;border-radius:4px;">Ticket #${ticketNumber}</span>
      <span style="display:inline-block;margin-left:8px;background:#d1fae5;color:#065f46;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;padding:3px 10px;border-radius:999px;">Open</span>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${fieldRow('Submitted', submittedAt)}
      ${fieldRow('Name', escapeHtml(name))}
      ${fieldRow('Email', `<a href="mailto:${escapeHtml(email)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">${escapeHtml(email)}</a>`)}
      ${fieldRow('Subject', escapeHtml(subject))}
      ${fieldRow('IP Address', escapeHtml(ip || 'N/A'))}
      ${fieldRow('User Agent', escapeHtml(userAgent || 'N/A'))}
    </table>
  `);

  const messageHtml = card(`
    <h2 style="margin:0 0 12px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Message</h2>
    <p style="margin:0;font-size:15px;color:#1f2937;line-height:1.7;white-space:pre-wrap;">${escapeHtml(message)}</p>
  `);

  return emailWrapper(`
    <tr>
      <td style="padding-bottom:8px;">
        <h1 style="margin:0 0 4px;font-size:22px;color:#1f2937;font-weight:700;letter-spacing:-0.5px;">New Contact Form Submission</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#64748b;">A visitor has submitted a message through the contact form.</p>
      </td>
    </tr>
    <tr><td>${body}</td></tr>
    <tr><td>${messageHtml}</td></tr>
  `);
}

// ====== Auto-Reply Confirmation ======
function buildAutoReplyEmail({ ticketNumber, name, email, subject, message, submittedAt }) {
  const body = card(`
    <h2 style="margin:0 0 4px;font-size:18px;color:#1f2937;font-weight:700;">Hi ${escapeHtml(name)},</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">Thank you for reaching out to CopyQuick! We've received your message and our team will review it shortly.</p>
    
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="padding:12px;background:#f8fafc;border-radius:8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:12px;font-weight:600;color:#64748b;padding:4px 8px;">Ticket</td>
              <td style="font-size:14px;font-weight:700;color:#4f46e5;padding:4px 0;">${ticketNumber}</td>
            </tr>
            <tr>
              <td style="font-size:12px;font-weight:600;color:#64748b;padding:4px 8px;">Status</td>
              <td style="padding:4px 0;">
                <span style="display:inline-block;background:#d1fae5;color:#065f46;font-size:11px;font-weight:700;text-transform:uppercase;padding:2px 8px;border-radius:999px;">Open</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;font-weight:600;color:#64748b;padding:4px 8px;">Submitted</td>
              <td style="font-size:13px;color:#1f2937;padding:4px 0;">${submittedAt}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 4px;font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Your Message</p>
    <div style="background:#f8fafc;border-left:3px solid #4f46e5;padding:12px 16px;margin-bottom:20px;border-radius:4px;">
      <p style="margin:0 0 4px;font-size:12px;color:#64748b;font-weight:600;">Subject: ${escapeHtml(subject)}</p>
      <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</p>
    </div>

    <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">Our team will review your message as soon as possible. If you have any additional information to add, please reply to this email and reference your ticket number.</p>
  `);

  return emailWrapper(`
    <tr>
      <td style="padding-bottom:8px;">
        <h1 style="margin:0 0 4px;font-size:22px;color:#1f2937;font-weight:700;letter-spacing:-0.5px;">We received your message</h1>
        <p style="margin:0 0 16px;font-size:14px;color:#64748b;">Your ticket has been created and our team has been notified.</p>
      </td>
    </tr>
    <tr><td>${body}</td></tr>
  `);
}

// ====== Send Contact Emails ======
async function sendContactFormEmails({ name, email, subject, message, ip, userAgent }, options = {}) {
  const ticketNumber = generateTicketNumber();
  const now = options.now instanceof Date ? options.now : new Date();
  const submittedAt = formatDate(now);
  const emailClient = Object.prototype.hasOwnProperty.call(options, 'resendClient')
    ? options.resendClient
    : resend;
  const operationKey = (options.operationKeyFactory || crypto.randomUUID)();
  const logger = options.logger || writeOperationalEvent;
  const monotonicNow = options.monotonicNow || (() => performance.now());
  const operationStartedAt = monotonicNow();
  const operationTimeoutMs = contactTotalTimeoutMs(options.contactTotalTimeoutMs);
  const deliveryTimeoutMs = boundedPositiveInteger(
    options.totalTimeoutMs,
    DEFAULT_EMAIL_TOTAL_TIMEOUT_MS,
    MAX_EMAIL_TOTAL_TIMEOUT_MS
  );

  function remainingOperationMs() {
    return Math.max(0, operationTimeoutMs - (monotonicNow() - operationStartedAt));
  }

  if (!emailClient) {
    logger({ event: 'email_delivery_failed', operation: 'contact_admin', code: 'EMAIL_PROVIDER_UNAVAILABLE' });
    throw new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE');
  }

  // Header values are sanitized defensively; HTML output is escaped at render time.
  const safe = {
    name,
    email: sanitizeHeaderValue(email),
    subject: sanitizeHeaderValue(subject),
    message,
    ip,
    userAgent
  };

  // Render plain text fallback for auto-reply
  const autoReplyText = `Hi ${safe.name},\n\nThank you for reaching out to CopyQuick! We've received your message.\n\nTicket: ${ticketNumber}\nStatus: Open\nSubmitted: ${submittedAt}\n\nYour Message:\nSubject: ${safe.subject}\n${safe.message}\n\nOur team will review your message as soon as possible. If you have any additional information, please reply to this email and reference your ticket number.\n\n— CopyQuick Support\nsupport@copyquick.co | copyquick.co`;

  // 1. Send admin notification to support@copyquick.co
  const adminHtml = buildAdminEmail({
    ticketNumber,
    name: safe.name,
    email: safe.email,
    subject: safe.subject,
    message: safe.message,
    ip: safe.ip,
    userAgent: safe.userAgent,
    submittedAt
  });

  const adminDelivery = await sendEmailWithRetry({
    client: emailClient,
    payload: {
      from: 'CopyQuick Support <support@copyquick.co>',
      to: ['support@copyquick.co'],
      subject: `[CopyQuick Contact] ${safe.subject} - ${ticketNumber}`,
      html: adminHtml,
      reply_to: safe.email,
    },
    idempotencyKey: `${operationKey}:admin`,
    operation: 'contact_admin',
    maxAttempts: options.maxAttempts,
    retryBaseMs: options.retryBaseMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    totalTimeoutMs: Math.min(deliveryTimeoutMs, remainingOperationMs()),
    sleep: options.sleep,
    setTimeoutFn: options.setTimeoutFn,
    clearTimeoutFn: options.clearTimeoutFn,
    logger
  });

  // 2. Send auto-reply to the visitor
  const autoReplyHtml = buildAutoReplyEmail({
    ticketNumber,
    name: safe.name,
    email: safe.email,
    subject: safe.subject,
    message: safe.message,
    submittedAt
  });

  let autoReplyDelivery;
  const replyBudgetMs = remainingOperationMs();
  if (replyBudgetMs < 1) {
    logger({
      event: 'email_delivery_skipped',
      operation: 'contact_reply',
      code: 'EMAIL_OPERATION_DEADLINE_EXCEEDED'
    });
    autoReplyDelivery = { delivered: false, code: 'EMAIL_OPERATION_DEADLINE_EXCEEDED' };
  }
  try {
    if (!autoReplyDelivery) autoReplyDelivery = await sendEmailWithRetry({
      client: emailClient,
      payload: {
        from: 'CopyQuick Support <support@copyquick.co>',
        to: [safe.email],
        subject: `We received your message - ${ticketNumber}`,
        html: autoReplyHtml,
        text: autoReplyText,
      },
      idempotencyKey: `${operationKey}:reply`,
      operation: 'contact_reply',
      maxAttempts: options.maxAttempts,
      retryBaseMs: options.retryBaseMs,
      attemptTimeoutMs: options.attemptTimeoutMs,
      totalTimeoutMs: Math.min(deliveryTimeoutMs, replyBudgetMs),
      sleep: options.sleep,
      setTimeoutFn: options.setTimeoutFn,
      clearTimeoutFn: options.clearTimeoutFn,
      logger
    });
  } catch (error) {
    autoReplyDelivery = { delivered: false, code: error.code || 'EMAIL_DELIVERY_FAILED' };
  }

  return {
    ticketNumber,
    adminDelivered: adminDelivery.delivered,
    autoReplyDelivered: autoReplyDelivery.delivered
  };
}

async function sendPasswordResetEmail({ email, resetUrl }, options = {}) {
  const emailClient = Object.prototype.hasOwnProperty.call(options, 'resendClient')
    ? options.resendClient
    : resend;
  const safeEmail = sanitizeHeaderValue(email);
  const safeUrl = escapeHtml(resetUrl);
  const html = emailWrapper(`<tr><td>${card(`
    <h1 style="margin:0 0 12px;font-size:22px;color:#1f2937;">Reset your password</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;">Use the secure link below within one hour. If you did not request this, you can ignore this email.</p>
    <p style="margin:24px 0;"><a href="${safeUrl}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;">Choose a new password</a></p>
    <p style="font-size:12px;color:#64748b;word-break:break-all;">${safeUrl}</p>
  `)}</td></tr>`);
  return sendEmailWithRetry({
    client: emailClient,
    payload: {
      from: 'CopyQuick Security <support@copyquick.co>',
      to: [safeEmail],
      subject: 'Reset your CopyQuick password',
      html,
      text: `Reset your CopyQuick password within one hour:\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`
    },
    idempotencyKey: `password-reset:${crypto.createHash('sha256').update(resetUrl).digest('hex')}`,
    operation: 'password_reset',
    maxAttempts: options.maxAttempts,
    retryBaseMs: options.retryBaseMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    totalTimeoutMs: options.totalTimeoutMs,
    sleep: options.sleep,
    setTimeoutFn: options.setTimeoutFn,
    clearTimeoutFn: options.clearTimeoutFn,
    logger: options.logger || writeOperationalEvent
  });
}

module.exports = {
  DEFAULT_CONTACT_TOTAL_TIMEOUT_MS,
  DEFAULT_EMAIL_ATTEMPT_TIMEOUT_MS,
  DEFAULT_EMAIL_MAX_ATTEMPTS,
  DEFAULT_EMAIL_RETRY_BASE_MS,
  DEFAULT_EMAIL_TOTAL_TIMEOUT_MS,
  MAX_EMAIL_ATTEMPT_TIMEOUT_MS,
  MAX_EMAIL_ATTEMPTS,
  MAX_EMAIL_RETRY_BASE_MS,
  MAX_EMAIL_TOTAL_TIMEOUT_MS,
  MAX_CONTACT_TOTAL_TIMEOUT_MS,
  EmailDeliveryError,
  boundedPositiveInteger,
  contactTotalTimeoutMs,
  normalizedEmailFailure,
  sendContactFormEmails,
  sendPasswordResetEmail,
  sendEmailWithRetry
};
