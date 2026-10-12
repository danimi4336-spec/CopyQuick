function sourceText(value) {
  return String(value ?? '');
}

function lastResetBoundary(value, index) {
  const prefix = value.slice(0, index);
  let start = Math.max(
    prefix.lastIndexOf('.'),
    prefix.lastIndexOf('!'),
    prefix.lastIndexOf('?'),
    prefix.lastIndexOf(';'),
    prefix.lastIndexOf('\n')
  ) + 1;
  const reset = /\b(?:but|however|instead|rather|whereas)\b|(?:,\s*(?:and\s+)?|\band\s+)(?:we|our|this|that|the\s+(?:company|product|service|offer|business)|customers?|users?|visitors?|they)\b/gi;
  for (const match of prefix.matchAll(reset)) start = Math.max(start, match.index + match[0].length);
  return start;
}

function isNegatedMatch(value, index) {
  const input = sourceText(value);
  const prefix = input.slice(lastResetBoundary(input, index), index);
  return /(?:\bdo\s+not\s+(?:reuse|use|inherit|include|carry|apply)\b|\bdon['’]?t\s+(?:reuse|use|inherit|include|carry|apply)\b|\bdoes\s+not\s+(?:use|include|involve|require|offer|support)\b|\bdoesn['’]?t\s+(?:use|include|involve|require|offer|support)\b|\bshould\s+not\s+(?:inherit|use|include|reuse)\b|\bshouldn['’]?t\s+(?:inherit|use|include|reuse)\b|\bnot\s+to\s+(?:reuse|use|inherit|include|carry|apply)\b|\bnot\s+(?!only\b)(?:an?\s+|the\s+)?|\bno\s+|\bwithout\s+|\b(?:exclude|excluding|excluded)\s+|\bdifferent\s+from\s+|\bunlike\s+)[\s\S]{0,240}$/i.test(prefix);
}

function globalPattern(pattern) {
  const flags = new Set(pattern.flags.replace(/y/g, '').split(''));
  flags.add('g');
  return new RegExp(pattern.source, [...flags].join(''));
}

function positiveMatches(value, pattern) {
  const input = sourceText(value);
  return [...input.matchAll(globalPattern(pattern))].filter(match => !isNegatedMatch(input, match.index));
}

function firstPositiveMatch(value, pattern) {
  return positiveMatches(value, pattern)[0] || null;
}

function hasPositiveMatch(value, pattern) {
  return Boolean(firstPositiveMatch(value, pattern));
}

module.exports = { firstPositiveMatch, hasPositiveMatch, isNegatedMatch, positiveMatches };
