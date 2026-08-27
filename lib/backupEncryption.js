const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('CQBKUP01');
const FORMAT = 'copyquick-encrypted-backup';
const VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
// V1 buffers encryption/decryption data. A 64 MiB artifact keeps the current
// 3-5x peak amplification below roughly 320 MiB on a 512 MiB Render service.
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const CONTAINER_PREFIX_BYTES = MAGIC.length + 4;
const SOURCE_BACKUP_PATTERN = /^copyquick-\d{4}-\d{2}-\d{2}T\d{6}Z(?:-\d+)?\.db$/;
const HEADER_FIELDS = [
  'format', 'version', 'encryption', 'keyId', 'createdAt', 'sourceBackupName',
  'nonce', 'plaintextSha256', 'authTag', 'ciphertextSha256'
];

class BackupEncryptionError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BackupEncryptionError';
    this.code = code;
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodeEncryptionKey(value) {
  const encoded = typeof value === 'string' ? value : '';
  if (!encoded || /placeholder|replace|your[_ -]?key/i.test(encoded) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new BackupEncryptionError('Off-site backup encryption key is invalid.', 'INVALID_ENCRYPTION_KEY');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new BackupEncryptionError('Off-site backup encryption key must decode to exactly 32 bytes.', 'INVALID_ENCRYPTION_KEY');
  }
  return key;
}

function canonicalBase64Bytes(value, expectedBytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === expectedBytes && decoded.toString('base64') === value ? decoded : null;
}

function strictIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function validateArtifactSize(sizeBytes, maximumBytes = DEFAULT_MAX_ARTIFACT_BYTES) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > maximumBytes) {
    throw new BackupEncryptionError('Encrypted backup artifact size is invalid.', 'BACKUP_ARTIFACT_SIZE_INVALID');
  }
  return sizeBytes;
}

function validateHeader(header) {
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new BackupEncryptionError('Encrypted backup header is invalid.', 'INVALID_BACKUP_HEADER');
  }
  const keys = Object.keys(header).sort();
  if (keys.length !== HEADER_FIELDS.length || !HEADER_FIELDS.every(field => keys.includes(field))) {
    throw new BackupEncryptionError('Encrypted backup header fields are invalid.', 'INVALID_BACKUP_HEADER');
  }
  if (header.format !== FORMAT || header.version !== VERSION || header.encryption !== ALGORITHM) {
    throw new BackupEncryptionError('Encrypted backup format is unsupported.', 'UNSUPPORTED_BACKUP_FORMAT');
  }
  validateKeyId(header.keyId);
  if (!strictIsoTimestamp(header.createdAt) || typeof header.sourceBackupName !== 'string' ||
      header.sourceBackupName.length > 128 || !SOURCE_BACKUP_PATTERN.test(header.sourceBackupName) ||
      !canonicalBase64Bytes(header.nonce, 12) || !canonicalBase64Bytes(header.authTag, 16) ||
      typeof header.plaintextSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(header.plaintextSha256) ||
      typeof header.ciphertextSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(header.ciphertextSha256)) {
    throw new BackupEncryptionError('Encrypted backup header is invalid.', 'INVALID_BACKUP_HEADER');
  }
  return header;
}

function validateKeyId(value) {
  const keyId = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId)) {
    throw new BackupEncryptionError('Off-site backup key ID is invalid.', 'INVALID_KEY_ID');
  }
  return keyId;
}

function authenticatedMetadata(header) {
  return Buffer.from(JSON.stringify({
    format: header.format,
    version: header.version,
    encryption: header.encryption,
    keyId: header.keyId,
    createdAt: header.createdAt,
    sourceBackupName: header.sourceBackupName,
    nonce: header.nonce,
    plaintextSha256: header.plaintextSha256
  }));
}

function encodeArtifact(header, ciphertext) {
  const headerBuffer = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBuffer.length);
  return Buffer.concat([MAGIC, length, headerBuffer, ciphertext]);
}

function parseArtifact(buffer, { maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES } = {}) {
  try {
    validateArtifactSize(Buffer.isBuffer(buffer) ? buffer.length : 0, maxArtifactBytes);
    if (!Buffer.isBuffer(buffer) || buffer.length < MAGIC.length + 4 || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Invalid magic.');
    }
    const headerLength = buffer.readUInt32BE(MAGIC.length);
    const headerStart = MAGIC.length + 4;
    const ciphertextStart = headerStart + headerLength;
    if (!Number.isSafeInteger(headerLength) || headerLength < 2 || headerLength > MAX_HEADER_BYTES ||
        ciphertextStart < CONTAINER_PREFIX_BYTES || ciphertextStart >= buffer.length) throw new Error('Invalid header length.');
    const header = JSON.parse(buffer.subarray(headerStart, ciphertextStart).toString('utf8'));
    validateHeader(header);
    return { header, ciphertext: buffer.subarray(ciphertextStart) };
  } catch (error) {
    if (error instanceof BackupEncryptionError) throw error;
    throw new BackupEncryptionError('Encrypted backup artifact is malformed.', 'INVALID_BACKUP_ARTIFACT', error);
  }
}

function encryptBackupFile({ sourcePath, destinationPath, encryptionKey, keyId, createdAt = new Date(), fsApi = fs, maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES }) {
  const key = Buffer.isBuffer(encryptionKey) ? encryptionKey : decodeEncryptionKey(encryptionKey);
  if (key.length !== 32) throw new BackupEncryptionError('Encryption key must be 32 bytes.', 'INVALID_ENCRYPTION_KEY');
  const safeKeyId = validateKeyId(keyId);
  const plaintext = fsApi.readFileSync(sourcePath);
  if (plaintext.length > maxArtifactBytes - MAX_HEADER_BYTES - CONTAINER_PREFIX_BYTES) {
    throw new BackupEncryptionError('Local backup is too large for configured off-site artifact limits.', 'LOCAL_BACKUP_TOO_LARGE');
  }
  const nonce = crypto.randomBytes(12);
  const baseHeader = {
    format: FORMAT,
    version: VERSION,
    encryption: ALGORITHM,
    keyId: safeKeyId,
    createdAt: new Date(createdAt).toISOString(),
    sourceBackupName: path.basename(sourcePath),
    nonce: nonce.toString('base64'),
    plaintextSha256: sha256(plaintext)
  };
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(authenticatedMetadata(baseHeader));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const header = {
    ...baseHeader,
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertextSha256: sha256(ciphertext)
  };
  const artifact = encodeArtifact(header, ciphertext);
  validateArtifactSize(artifact.length, maxArtifactBytes);
  fsApi.writeFileSync(destinationPath, artifact, { mode: 0o600, flag: 'wx' });
  fsApi.chmodSync(destinationPath, 0o600);
  return { header, sizeBytes: artifact.length };
}

function decryptArtifactBuffer(buffer, encryptionKey, { maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES } = {}) {
  const key = Buffer.isBuffer(encryptionKey) ? encryptionKey : decodeEncryptionKey(encryptionKey);
  if (key.length !== 32) throw new BackupEncryptionError('Encryption key must be 32 bytes.', 'INVALID_ENCRYPTION_KEY');
  const { header, ciphertext } = parseArtifact(buffer, { maxArtifactBytes });
  if (sha256(ciphertext) !== header.ciphertextSha256) {
    throw new BackupEncryptionError('Encrypted backup ciphertext hash does not match.', 'CIPHERTEXT_HASH_MISMATCH');
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, canonicalBase64Bytes(header.nonce, 12));
    decipher.setAAD(authenticatedMetadata(header));
    decipher.setAuthTag(canonicalBase64Bytes(header.authTag, 16));
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (sha256(plaintext) !== header.plaintextSha256) {
      throw new BackupEncryptionError('Decrypted backup hash does not match.', 'PLAINTEXT_HASH_MISMATCH');
    }
    return { header, plaintext };
  } catch (error) {
    if (error instanceof BackupEncryptionError) throw error;
    throw new BackupEncryptionError('Encrypted backup authentication failed.', 'BACKUP_AUTHENTICATION_FAILED', error);
  }
}

function verifyEncryptedArtifact(artifactPath, encryptionKey, fsApi = fs, maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES) {
  const artifact = fsApi.readFileSync(artifactPath);
  const result = decryptArtifactBuffer(artifact, encryptionKey, { maxArtifactBytes });
  return { header: result.header, sizeBytes: artifact.length };
}

function decryptArtifactFile({ artifactPath, destinationPath, encryptionKey, fsApi = fs, maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES }) {
  const result = decryptArtifactBuffer(fsApi.readFileSync(artifactPath), encryptionKey, { maxArtifactBytes });
  fsApi.writeFileSync(destinationPath, result.plaintext, { mode: 0o600, flag: 'wx' });
  fsApi.chmodSync(destinationPath, 0o600);
  return { header: result.header, sizeBytes: result.plaintext.length };
}

module.exports = {
  ALGORITHM,
  DEFAULT_MAX_ARTIFACT_BYTES,
  FORMAT,
  MAGIC,
  MAX_HEADER_BYTES,
  VERSION,
  BackupEncryptionError,
  decodeEncryptionKey,
  decryptArtifactBuffer,
  decryptArtifactFile,
  encryptBackupFile,
  parseArtifact,
  sha256,
  validateKeyId,
  validateArtifactSize,
  validateHeader,
  verifyEncryptedArtifact
};
