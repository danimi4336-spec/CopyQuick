const { currentOperationalContext } = require('./requestContext');

const ALLOWED_FIELDS = new Set([
  'event', 'requestId', 'method', 'route', 'statusCode', 'durationMs',
  'operation', 'code', 'productionRunId', 'productionJobId', 'outcome', 'count',
  'executionMode', 'isolated'
  ,'providerCategory', 'operationCategory', 'failureCategory', 'attempts', 'sourceCount',
  'inputTokens', 'outputTokens', 'estimatedCostMicros', 'circuitState'
]);

const STRING_PATTERNS = {
  event: /^[a-z0-9_]+$/,
  requestId: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  method: /^[A-Z]{3,10}$/,
  route: /^\/[A-Za-z0-9_/:.-]*$|^unmatched$/,
  operation: /^[a-z0-9:_-]+$/i,
  executionMode: /^(standard|acceptance)$/,
  code: /^[A-Z0-9_:-]+$/,
  outcome: /^[a-z0-9_-]+$/
  ,providerCategory: /^[a-z0-9_-]+$/, operationCategory: /^[a-z0-9_-]+$/,
  failureCategory: /^[A-Z0-9_]+$/, circuitState: /^(CLOSED|OPEN|HALF_OPEN)$/
};

function sanitizedOperationalEvent(entry = {}) {
  const combined = { ...currentOperationalContext(), ...entry };
  return Object.fromEntries(Object.entries(combined).filter(function([key, value]) {
    if (!ALLOWED_FIELDS.has(key) || !['string', 'number', 'boolean'].includes(typeof value)) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'string') return true;
    return value.length <= 160 && (!STRING_PATTERNS[key] || STRING_PATTERNS[key].test(value));
  }));
}

function writeOperationalEvent(entry, consoleApi = console) {
  const sanitized = sanitizedOperationalEvent(entry);
  if (!sanitized.event) return false;
  const output = JSON.stringify(sanitized);
  if (String(sanitized.event).includes('failed') || Number(sanitized.statusCode) >= 500) {
    consoleApi.error(output);
  } else if (Number(sanitized.statusCode) >= 400) {
    consoleApi.warn(output);
  } else {
    consoleApi.log(output);
  }
  return true;
}

module.exports = { sanitizedOperationalEvent, writeOperationalEvent };
