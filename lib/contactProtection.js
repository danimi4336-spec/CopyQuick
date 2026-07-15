const { requestPrefersJson } = require('./errorHandler');

const CONTACT_LIMIT_ERROR = 'Too many contact requests. Please try again later.';
const CONTACT_VALIDATION_ERROR = 'Please check the contact form and try again.';

const CONTACT_FIELD_LIMITS = {
  name: 100,
  email: 254,
  subject: 150,
  message: 5000
};

function normalizeText(value) {
  return String(value || '').trim();
}

function hasHeaderBreak(value) {
  return /[\r\n]/.test(String(value || ''));
}

function isValidEmail(email) {
  if (!email || email.length > CONTACT_FIELD_LIMITS.email || hasHeaderBreak(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateContactSubmission(body = {}) {
  const contact = {
    name: normalizeText(body.name),
    email: normalizeText(body.email).toLowerCase(),
    subject: normalizeText(body.subject),
    message: normalizeText(body.message)
  };

  const errors = [];
  if (!contact.name) errors.push('name_required');
  if (!contact.email) errors.push('email_required');
  if (!contact.subject) errors.push('subject_required');
  if (!contact.message) errors.push('message_required');

  for (const [field, limit] of Object.entries(CONTACT_FIELD_LIMITS)) {
    if (contact[field] && contact[field].length > limit) {
      errors.push(`${field}_too_long`);
    }
  }

  if (contact.name && hasHeaderBreak(contact.name)) errors.push('name_invalid');
  if (contact.subject && hasHeaderBreak(contact.subject)) errors.push('subject_invalid');
  if (contact.email && !isValidEmail(contact.email)) errors.push('email_invalid');

  return {
    ok: errors.length === 0,
    contact,
    errors
  };
}

function sendContactFailure(req, res, statusCode, message) {
  res.status(statusCode);

  if (requestPrefersJson(req)) {
    return res.json({ error: message });
  }

  return res.render('contact', {
    title: 'Contact - CopyQuick',
    currentPage: 'contact',
    sent: false,
    error: message
  });
}

function createContactRateLimiter(options = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000;
  const max = options.max || 5;
  const now = options.now || (() => Date.now());
  const buckets = new Map();

  return function contactRateLimiter(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const currentTime = now();
    const existing = buckets.get(key);
    const bucket = existing && existing.resetAt > currentTime
      ? existing
      : { count: 0, resetAt: currentTime + windowMs };

    if (bucket.count >= max) {
      buckets.set(key, bucket);
      return sendContactFailure(req, res, 429, CONTACT_LIMIT_ERROR);
    }

    bucket.count += 1;
    buckets.set(key, bucket);
    return next();
  };
}

function createContactHandler({ sendContactFormEmails }) {
  return async function contactHandler(req, res) {
    const validation = validateContactSubmission(req.body);
    if (!validation.ok) {
      return sendContactFailure(req, res, 400, CONTACT_VALIDATION_ERROR);
    }

    const ip = req.ip || req.socket?.remoteAddress || 'N/A';
    const userAgent = req.headers['user-agent'] || 'N/A';

    try {
      const { ticketNumber } = await sendContactFormEmails({
        ...validation.contact,
        ip,
        userAgent
      });
      console.log('Contact form processed.');

      if (requestPrefersJson(req)) {
        return res.json({ success: true });
      }

      return res.render('contact', {
        title: 'Contact - CopyQuick',
        currentPage: 'contact',
        sent: true,
        error: null
      });
    } catch (err) {
      console.error('Contact form error.');
      return sendContactFailure(req, res, 500, 'Sorry, your message could not be sent. Please try again later.');
    }
  };
}

module.exports = {
  CONTACT_FIELD_LIMITS,
  CONTACT_LIMIT_ERROR,
  CONTACT_VALIDATION_ERROR,
  createContactHandler,
  createContactRateLimiter,
  validateContactSubmission
};
