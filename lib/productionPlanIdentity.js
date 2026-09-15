const MAX_PRODUCTION_PLAN_NAME_LENGTH = 72;

function cleanPlanName(value) {
  const cleaned = String(value || '')
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/gi, '')
    .replace(/[{}\[\]<>`"\\|]/g, ' ')
    .replace(/[^\p{L}\p{N}&'’+\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PRODUCTION_PLAN_NAME_LENGTH)
    .trim();
  if (cleaned.length < 3 || /^\d+$/.test(cleaned)) return null;
  return cleaned.replace(/\b\p{L}/gu, letter => letter.toUpperCase());
}

function deriveProductionPlanName(discoverySession) {
  const objective = discoverySession?.objective;
  const description = String(discoverySession?.answers?.initial_description || '').replace(/\s+/g, ' ').trim();
  const patterns = objective === 'get_more_customers'
    ? [/(?:sell|offer|promote|market)\s+(?:a|an|the|my)?\s*([^,.!?;]{3,100}?)(?=\s+(?:for|to|through|on|via|that|which|with)\b|[,.!?;]|$)/i]
    : [/(?:launch|sell|create|build|make)\s+(?:a|an|the|my)?\s*([^,.!?;]{3,100}?)(?=\s+(?:for|to|through|on|via|that|which|with)\b|[,.!?;]|$)/i];
  for (const pattern of patterns) {
    const name = cleanPlanName(description.match(pattern)?.[1]);
    if (name) return name;
  }
  return objective === 'get_more_customers' ? 'Customer Growth Plan' : 'Product Launch Plan';
}

function productionPlanName(production, progressSet) {
  return cleanPlanName(progressSet?.displayName)
    || (production?.objective === 'get_more_customers' ? 'Customer Growth Plan' : 'Product Launch Plan');
}

module.exports = {
  MAX_PRODUCTION_PLAN_NAME_LENGTH,
  cleanPlanName,
  deriveProductionPlanName,
  productionPlanName
};
