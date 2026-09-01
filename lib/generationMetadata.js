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

function buildPaginationPages(totalPages, currentPage, maxLinks = 7) {
  const total = Number.isSafeInteger(totalPages) && totalPages > 0 ? totalPages : 0;
  const limit = Number.isSafeInteger(maxLinks) && maxLinks > 0 ? maxLinks : 7;
  if (total <= limit) return Array.from({ length: total }, (_, index) => index + 1);
  const current = Math.min(Math.max(Number(currentPage) || 1, 1), total);
  const pages = new Set([1, total, current]);
  for (let radius = 1; pages.size < limit && radius < total; radius += 1) {
    for (const candidate of [current - radius, current + radius]) {
      if (candidate > 1 && candidate < total && pages.size < limit) pages.add(candidate);
    }
  }
  return [...pages].sort((left, right) => left - right);
}

module.exports = {
  GENERATION_METADATA_LIMITS,
  MAX_HISTORY_PAGE,
  boundedQueryText,
  buildPaginationPages,
  parseHistoryPage,
  validateOptionalText
};
