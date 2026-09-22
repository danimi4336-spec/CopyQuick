const MALFORMED_TRANSITION = /\b(?:consider whether|ask whether|decide whether)\s+(For|If|When|Because|Although|While)\b/gi;
const DUPLICATED_WORD = /\b([A-Za-z][A-Za-z'-]{2,})\s+\1\b/gi;
const SPACE_BEFORE_PUNCTUATION = /\s+([,.;:!?])/g;

const ABSOLUTE_REPAIRS = Object.freeze([
  [/\bonly becomes useful when\b/gi, 'is more useful when'],
  [/\bworks best when\b/gi, 'can work more effectively when']
]);

const RISKY_ABSOLUTES = Object.freeze([
  { rule: 'absolute_guarantee', pattern: /\b(?:guarantees?|guaranteed to|will always|can never fail)\b/i },
  { rule: 'absolute_exclusivity', pattern: /\b(?:only becomes useful when|works best when)\b/i }
]);

function cleanEditorialText(value) {
  let text = String(value || '');
  text = text.replace(MALFORMED_TRANSITION, '$1');
  text = text.replace(DUPLICATED_WORD, '$1');
  text = text.replace(SPACE_BEFORE_PUNCTUATION, '$1');
  for (const [pattern, replacement] of ABSOLUTE_REPAIRS) text = text.replace(pattern, replacement);
  return text;
}

function repairValue(value) {
  if (typeof value === 'string') return cleanEditorialText(value);
  if (Array.isArray(value)) return value.map(repairValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, repairValue(child)]));
  }
  return value;
}

function repairEditorialOutput(output, contract) {
  if (!output || typeof output !== 'object' || !contract) return output;
  const repaired = { ...output };
  for (const key of contract.publicFieldKeys || []) {
    if (repaired[key] !== undefined) repaired[key] = repairValue(repaired[key]);
  }
  return repaired;
}

function excerptAt(text, index, length = 180) {
  const start = Math.max(0, index - 50);
  return text.slice(start, start + length).replace(/\s+/g, ' ').trim();
}

function inspectText(value, field) {
  const text = String(value || '');
  const issues = [];
  const rules = [
    { rule: 'malformed_transition', pattern: /\b(?:consider whether|ask whether|decide whether)\s+(?:For|If|When|Because|Although|While)\b/i },
    { rule: 'duplicated_word', pattern: /\b([A-Za-z][A-Za-z'-]{2,})\s+\1\b/i },
    { rule: 'space_before_punctuation', pattern: /\s+[,.;:!?]/ }
  ];
  for (const item of [...rules, ...RISKY_ABSOLUTES]) {
    const match = item.pattern.exec(text);
    if (match) issues.push({ field, rule: item.rule, excerpt: excerptAt(text, match.index) });
  }
  return issues;
}

function inspectValue(value, field) {
  if (typeof value === 'string') return inspectText(value, field);
  if (Array.isArray(value)) return value.flatMap((item, index) => inspectValue(item, `${field}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => inspectValue(child, `${field}.${key}`));
  }
  return [];
}

function inspectEditorialOutput(output, contract) {
  if (!output || !contract) return [];
  return (contract.publicFieldKeys || [])
    .flatMap(key => inspectValue(output[key], key))
    .slice(0, 12);
}

module.exports = {
  cleanEditorialText,
  repairEditorialOutput,
  inspectEditorialOutput
};
