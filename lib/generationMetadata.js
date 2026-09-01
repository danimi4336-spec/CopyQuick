const GENERATION_METADATA_LIMITS = Object.freeze({
  title: 200,
  tags: 500,
  search: 200
});

function validateOptionalText(value, maxLength) {
  const normalized = value === undefined || value === null ? '' : value;
  if (typeof normalized !== 'string' || normalized.length > maxLength || /[\u0000]/.test(normalized)) {
    return { valid: false, value: '' };
  }
  return { valid: true, value: normalized };
}

function boundedQueryText(value, maxLength = GENERATION_METADATA_LIMITS.search) {
  if (value === undefined) return '';
  const result = validateOptionalText(value, maxLength);
  return result.valid ? result.value : '';
}

module.exports = { GENERATION_METADATA_LIMITS, boundedQueryText, validateOptionalText };
