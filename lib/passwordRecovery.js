const crypto = require('crypto');
const { getSessionSecret } = require('./sessionConfig');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const RESET_TOKEN_MAX_LENGTH = 512;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 1024;

function tokenKey(user, env) {
  const credential = user.password_hash || `google:${user.google_id || 'none'}`;
  return crypto.createHmac('sha256', getSessionSecret(env))
    .update(`password-reset:${user.id}:${credential}`)
    .digest();
}

function signPayload(encoded, user, env) {
  return crypto.createHmac('sha256', tokenKey(user, env)).update(encoded).digest('base64url');
}

function createPasswordResetToken(user, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const payload = Buffer.from(JSON.stringify({
    userId: user.id,
    expiresAt: now.getTime() + (options.ttlMs || RESET_TOKEN_TTL_MS),
    nonce: (options.randomBytes || crypto.randomBytes)(24).toString('base64url')
  })).toString('base64url');
  return `${payload}.${signPayload(payload, user, options.env || process.env)}`;
}

function parseToken(token) {
  if (typeof token !== 'string' || !token || token.length > RESET_TOKEN_MAX_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(payload.userId) || payload.userId <= 0 ||
        !Number.isSafeInteger(payload.expiresAt) ||
        typeof payload.nonce !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(payload.nonce)) return null;
    return { encoded: parts[0], signature: parts[1], payload };
  } catch (err) {
    return null;
  }
}

function validatePasswordResetToken(db, token, options = {}) {
  const parsed = parseToken(token);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!parsed || parsed.payload.expiresAt <= now.getTime()) return null;
  const user = db.prepare('SELECT id, email, password_hash, google_id FROM users WHERE id = ?').get(parsed.payload.userId);
  if (!user) return null;
  const expected = signPayload(parsed.encoded, user, options.env || process.env);
  const left = Buffer.from(parsed.signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  return user;
}

function validateNewPassword(value) {
  return typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH &&
    value.length <= PASSWORD_MAX_LENGTH && !/[\r\n]/.test(value);
}

function revokeUserSessions(db, userId) {
  const ids = db.prepare('SELECT id, data FROM sessions').all().filter((row) => {
    try {
      const data = JSON.parse(row.data);
      return Number(data.userId) === Number(userId) || Number(data.passport?.user) === Number(userId);
    } catch (err) {
      return false;
    }
  }).map(row => row.id);
  const remove = db.prepare('DELETE FROM sessions WHERE id = ?');
  ids.forEach(id => remove.run(id));
  return ids.length;
}

async function resetPassword(db, token, newPassword, options = {}) {
  if (!validateNewPassword(newPassword)) return { ok: false, code: 'PASSWORD_INVALID' };
  const user = validatePasswordResetToken(db, token, options);
  if (!user) return { ok: false, code: 'TOKEN_INVALID' };
  const passwordHash = await (options.bcrypt || require('bcrypt')).hash(newPassword, 10);
  let sessionsRevoked = 0;
  db.transaction(() => {
    const current = validatePasswordResetToken(db, token, options);
    if (!current) throw new Error('RESET_TOKEN_INVALID');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
    sessionsRevoked = revokeUserSessions(db, user.id);
  })();
  return { ok: true, sessionsRevoked };
}

module.exports = {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESET_TOKEN_MAX_LENGTH,
  RESET_TOKEN_TTL_MS,
  createPasswordResetToken,
  resetPassword,
  revokeUserSessions,
  validateNewPassword,
  validatePasswordResetToken
};
