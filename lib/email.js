const RESEND_API_KEY = process.env.RESEND_API_KEY;
let resend = null;

if (RESEND_API_KEY) {
  const { Resend } = require('resend');
  resend = new Resend(RESEND_API_KEY);
} else {
  console.log('⚠️ RESEND_API_KEY not configured — email sending disabled.');
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
      ${fieldRow('Response Time', 'Within 24 business hours')}
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
            <tr>
              <td style="font-size:12px;font-weight:600;color:#64748b;padding:4px 8px;">Response Time</td>
              <td style="font-size:13px;color:#1f2937;padding:4px 0;">Within 24 business hours</td>
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

    <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">We aim to respond within <strong>24 business hours</strong>. If you have any additional information to add, please reply to this email and reference your ticket number.</p>
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
async function sendContactFormEmails({ name, email, subject, message, ip, userAgent }) {
  const ticketNumber = generateTicketNumber();
  const now = new Date();
  const submittedAt = formatDate(now);

  if (!resend) {
    console.warn('Email not sent — RESEND_API_KEY not configured');
    return { ticketNumber };
  }

  // Sanitize all user inputs
  const safe = { name, email, subject, message, ip, userAgent };

  // Render plain text fallback for auto-reply
  const autoReplyText = `Hi ${safe.name},\n\nThank you for reaching out to CopyQuick! We've received your message.\n\nTicket: ${ticketNumber}\nStatus: Open\nSubmitted: ${submittedAt}\nResponse Time: Within 24 business hours\n\nYour Message:\nSubject: ${safe.subject}\n${safe.message}\n\nWe aim to respond within 24 business hours. If you have any additional information, please reply to this email and reference your ticket number.\n\n— CopyQuick Support\nsupport@copyquick.co | copyquick.co`;

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

  const { data: adminData, error: adminError } = await resend.emails.send({
    from: 'CopyQuick Support <support@copyquick.co>',
    to: ['support@copyquick.co'],
    subject: `[CopyQuick Contact] ${safe.subject} - ${ticketNumber}`,
    html: adminHtml,
    reply_to: safe.email,
  });

  if (adminError) {
    console.error('Admin notification send error:', adminError);
    throw new Error('Failed to send admin notification');
  }

  console.log('Admin notification sent:', adminData?.id);

  // 2. Send auto-reply to the visitor
  const autoReplyHtml = buildAutoReplyEmail({
    ticketNumber,
    name: safe.name,
    email: safe.email,
    subject: safe.subject,
    message: safe.message,
    submittedAt
  });

  const { data: replyData, error: replyError } = await resend.emails.send({
    from: 'CopyQuick Support <support@copyquick.co>',
    to: [safe.email],
    subject: `We received your message - ${ticketNumber}`,
    html: autoReplyHtml,
    text: autoReplyText,
  });

  if (replyError) {
    console.error('Auto-reply send error:', replyError);
    // Don't throw — admin notification already succeeded
    console.warn('Auto-reply failed but admin notification was sent');
  } else {
    console.log('Auto-reply sent:', replyData?.id);
  }

  return { ticketNumber };
}

module.exports = { sendContactFormEmails };