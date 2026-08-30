const INTERNAL_LANGUAGE = [
  /create the approved .{0,100} deliverable/i,
  /completed prerequisite outputs?\s*\(structured\)/i,
  /treat strategic guidance as direction, not evidence/i,
  /use known facts as facts/i,
  /approved strategy\s*:/i,
  /approved source context\s*:/i,
  /do not invent (?:demographic|scientific|performance|regulated)/i,
  /(?:output|json) schema\s*:/i,
  /(?:contractVersion|contract_version|structured_result|dependencyOutputs)\b/i
];

function customerStrings(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach(item => customerStrings(item, result));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => customerStrings(item, result));
  return result;
}

function looksLikeSerializedContext(value) {
  const text = String(value || '').trim();
  if (/^```(?:json)?\s*[\[{]/i.test(text)) return true;
  if (/^[\[{]\s*"[A-Za-z][^"]*"\s*:/.test(text)) return true;
  return (text.match(/"[A-Za-z][A-Za-z0-9_]*"\s*:/g) || []).length >= 2;
}

function validateCustomerReadyOutput(output, contract) {
  if (!contract?.validateOutput(output)) return { valid: false, code: 'PRODUCTION_QUALITY_REQUIRED_CONTENT_MISSING' };
  const strings = customerStrings(output);
  if (!strings.length || strings.some(value => !value.trim())) return { valid: false, code: 'PRODUCTION_QUALITY_REQUIRED_CONTENT_MISSING' };
  for (const value of strings) {
    if (INTERNAL_LANGUAGE.some(pattern => pattern.test(value))) return { valid: false, code: 'PRODUCTION_QUALITY_INTERNAL_CONTEXT_LEAK' };
    if (looksLikeSerializedContext(value)) return { valid: false, code: 'PRODUCTION_QUALITY_SERIALIZED_CONTEXT_LEAK' };
  }
  return { valid: true, code: null };
}

function assertCustomerReadyOutput(output, contract) {
  const result = validateCustomerReadyOutput(output, contract);
  if (!result.valid) {
    const error = new Error('Production output did not meet customer-facing quality requirements');
    error.code = result.code;
    throw error;
  }
  return output;
}

module.exports = { assertCustomerReadyOutput, looksLikeSerializedContext, validateCustomerReadyOutput };
