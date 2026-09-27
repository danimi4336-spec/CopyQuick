const { isUnresolvedValue } = require('./objectiveInsights');

const BUSINESS_GOAL_AS_CUSTOMER_MOTIVATION = /\b(?:homeowners?|customers?|clients?|readers?|shoppers?|users?)\b[^.!?\n]{0,80}\b(?:want|need|seek|focused on|priority)\b[^.!?\n]{0,60}\b(?:qualified leads?|conversion rate|grow(?:th| revenue)|topical authority|search rankings?|scale spend|increase traffic)\b/i;
const BUSINESS_GOAL_PERSONALIZED = /\b(?:why|how)\b[^.!?\n]{0,60}\b(?:qualified leads?|conversion rate|grow(?:th| revenue)|topical authority|search rankings?|scale spend|increase traffic)\b[^.!?\n]{0,60}\b(?:priority|important|matter)\b[^.!?\n]{0,25}\b(?:you|your)\b/i;
const UNRESOLVED_LITERAL = /^\s*(?:(?:cta|headline|benefit|offer|motivation|need|product fact|availability|proof)\s*:\s*)?(?:i['’]?m not sure yet|not established|needs confirmation|unresolved|unknown)[.!]?\s*$/i;
const RAW_FIRST_PERSON = /\b(?:i|we|our)\s+(?:own|run|sell|publish|specialize|want|plan|get|have)\b/i;

function publicStrings(output, contract) {
  const result = [];
  const visit = value => {
    if (typeof value === 'string') result.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  (contract.publicFieldKeys || []).forEach(key => visit(output?.[key]));
  return result;
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function validateSemanticCoherence(output, contract, context = {}) {
  if (!contract?.readyToUse) return { valid: true };
  const strings = publicStrings(output, contract);
  const joined = strings.join('\n');
  if (strings.some(value => UNRESOLVED_LITERAL.test(value) || isUnresolvedValue(value))) {
    return { valid: false, code: 'PRODUCTION_QUALITY_UNRESOLVED_SEMANTIC_INPUT' };
  }
  if (BUSINESS_GOAL_AS_CUSTOMER_MOTIVATION.test(joined) || BUSINESS_GOAL_PERSONALIZED.test(joined)) {
    return { valid: false, code: 'PRODUCTION_QUALITY_SEMANTIC_ROLE_MISUSE' };
  }
  const raw = context.semanticInsights?.rawBuilderDescription;
  const rawValue = normalize(raw?.value);
  if (rawValue.length >= 30 && RAW_FIRST_PERSON.test(raw?.value) && strings.some(value => normalize(value).includes(rawValue))) {
    return { valid: false, code: 'PRODUCTION_QUALITY_RAW_DESCRIPTION_LEAK' };
  }
  const current = context.semanticInsights?.currentChannel;
  const recommended = context.semanticInsights?.recommendedChannel;
  if (current?.value && recommended?.unresolved) {
    const asserted = new RegExp(`recommended (?:channel|source)[^.!?]{0,30}${String(current.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (asserted.test(joined)) return { valid: false, code: 'PRODUCTION_QUALITY_CHANNEL_PROVENANCE' };
  }
  const searchGoal = normalize(context.semanticInsights?.searchGoal?.value);
  if (searchGoal && /\b(?:reader|customer|user)s?\b[^.!?\n]{0,80}\b(?:want|need|seek|motivation|priority)\b/i.test(joined)
    && strings.some(value => normalize(value).includes(searchGoal))) {
    return { valid: false, code: 'PRODUCTION_QUALITY_SEARCH_GOAL_AS_CUSTOMER_NEED' };
  }
  const exploration = normalize(context.semanticInsights?.explorationIntent?.value);
  if (exploration && strings.some(value => {
    const normalized = normalize(value);
    return exploration.split(/\s+/).filter(token => token.length > 5).some(token => normalized.includes(token))
      && /\b(?:contains|formulated with|clinically|proven|treats?|cures?|prevents?|relieves?|improves?)\b/i.test(value);
  })) return { valid: false, code: 'PRODUCTION_QUALITY_EXPLORATION_AS_FACT' };
  return { valid: true };
}

module.exports = { validateSemanticCoherence };
