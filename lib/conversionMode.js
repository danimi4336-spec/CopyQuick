const MODES = Object.freeze({
  SERVICE_CONSULTATION: 'SERVICE_CONSULTATION',
  ECOMMERCE_PURCHASE: 'ECOMMERCE_PURCHASE',
  SAAS_TRIAL_SIGNUP: 'SAAS_TRIAL_SIGNUP',
  LEAD_CAPTURE: 'LEAD_CAPTURE',
  UNRESOLVED: 'UNRESOLVED'
});

function value(understanding, key) {
  const field = understanding?.[key];
  if (!field || field.value == null || field.value === 'unsure' || field.source === 'unknown') return '';
  return String(field.value).toLowerCase();
}

function resolveConversionMode(understanding = {}) {
  const businessType = value(understanding, 'businessType');
  const industry = value(understanding, 'industry');
  const category = value(understanding, 'category');
  const action = `${value(understanding, 'funnelType')} ${value(understanding, 'primaryCta')}`;
  const service = businessType === 'service' || ['home_services', 'professional_services', 'automotive'].includes(industry);
  const software = businessType === 'software' || industry === 'technology';
  const consultation = /book(?:ed)?[_ ]?(?:call|appointment|consultation)|consultation|appointment|request[_ ]?(?:quote|consultation)|schedule[_ ]?(?:call|assessment)/.test(action);
  const purchase = /purchase|checkout|buy|order/.test(action);
  const signup = /trial|sign[_ ]?up|account|demo/.test(action);
  const lead = /lead|contact|inquiry|enquir|form/.test(action);

  if (service && consultation && !software) return MODES.SERVICE_CONSULTATION;
  if (purchase && !service && !software) return MODES.ECOMMERCE_PURCHASE;
  if (signup && !service) return MODES.SAAS_TRIAL_SIGNUP;
  if (lead) return MODES.LEAD_CAPTURE;
  return MODES.UNRESOLVED;
}

module.exports = { MODES, resolveConversionMode };
