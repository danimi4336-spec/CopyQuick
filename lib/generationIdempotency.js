const crypto = require('crypto');

const KEY_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

class GenerationRequestError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = 'GenerationRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function requestHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function normalizeKey(value) {
  const key = String(value || '').trim();
  return KEY_PATTERN.test(key) ? key : null;
}

function beginGenerationRequest(db, { userId, operation, key, request }) {
  if (key !== null && key !== undefined && String(key).trim() && !normalizeKey(key)) {
    throw new GenerationRequestError('Invalid generation request key.', 'IDEMPOTENCY_KEY_INVALID', 400);
  }
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return { enabled: false };
  const hash = requestHash(request);

  return db.transaction(() => {
    const existing = db.prepare(`
      SELECT * FROM generation_requests
      WHERE user_id = ? AND operation = ? AND idempotency_key = ?
    `).get(userId, operation, normalizedKey);
    if (existing) {
      if (existing.request_hash !== hash) {
        throw new GenerationRequestError(
          'This request key was already used for different generation inputs.',
          'IDEMPOTENCY_KEY_REUSED'
        );
      }
      if (existing.status === 'completed' && existing.generation_id) {
        return { enabled: true, replay: true, requestId: existing.id, generationId: existing.generation_id };
      }
      throw new GenerationRequestError(
        existing.status === 'in_progress'
          ? 'This generation request is already being processed.'
          : 'This generation request cannot be retried safely. Start a new request.',
        existing.status === 'in_progress' ? 'GENERATION_REQUEST_IN_PROGRESS' : 'GENERATION_REQUEST_FAILED'
      );
    }

    const inserted = db.prepare(`
      INSERT INTO generation_requests (
        user_id, operation, idempotency_key, request_hash, status, started_at
      ) VALUES (?, ?, ?, ?, 'in_progress', CURRENT_TIMESTAMP)
    `).run(userId, operation, normalizedKey, hash);
    return { enabled: true, replay: false, requestId: inserted.lastInsertRowid };
  })();
}

function completeGenerationRequest(db, requestId, generationId) {
  if (!requestId) return;
  const updated = db.prepare(`
    UPDATE generation_requests
    SET status = 'completed', generation_id = ?, completed_at = CURRENT_TIMESTAMP,
        error_code = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'in_progress'
  `).run(generationId, requestId);
  if (updated.changes !== 1) {
    throw new GenerationRequestError('Generation request ownership was lost.', 'GENERATION_REQUEST_OWNERSHIP_LOST');
  }
}

function failGenerationRequest(db, requestId, code = 'GENERATION_FAILED') {
  if (!requestId) return;
  const safeCode = /^[A-Z0-9_]{1,64}$/.test(String(code || '')) ? String(code) : 'GENERATION_FAILED';
  db.prepare(`
    UPDATE generation_requests
    SET status = 'failed', error_code = ?, completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'in_progress'
  `).run(safeCode, requestId);
}

function loadReplayGeneration(db, { userId, generationId }) {
  const generation = db.prepare(`
    SELECT * FROM generations WHERE id = ? AND user_id = ? AND is_deleted = 0
  `).get(generationId, userId);
  if (!generation) {
    throw new GenerationRequestError('The original generation is no longer available.', 'IDEMPOTENT_RESULT_UNAVAILABLE', 410);
  }
  return generation;
}

module.exports = {
  GenerationRequestError,
  beginGenerationRequest,
  completeGenerationRequest,
  failGenerationRequest,
  loadReplayGeneration,
  normalizeKey,
  requestHash
};
