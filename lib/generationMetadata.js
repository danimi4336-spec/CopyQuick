const GENERATION_METADATA_LIMITS = Object.freeze({
  title: 200,
  tags: 500,
  search: 200
});
const MAX_HISTORY_PAGE = 10000;

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

function parseHistoryPage(value) {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? Math.min(page, MAX_HISTORY_PAGE) : 1;
}

module.exports = { GENERATION_METADATA_LIMITS, MAX_HISTORY_PAGE, boundedQueryText, parseHistoryPage, validateOptionalText };
