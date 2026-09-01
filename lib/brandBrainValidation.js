const BRAND_VOICES = new Set(['professional', 'friendly', 'luxury', 'playful', 'bold', 'inspirational', 'custom']);
const BRAND_BRAIN_LIMITS = Object.freeze({
  business_name: 120,
  industry: 120,
  target_audience: 500,
  brand_voice_custom: 300,
  unique_value: 1000,
  competitors: 1000,
  goals: 1000,
  key_messages: 2000
});

function boundedText(value, limit) {
  if (value === undefined || value === null) return { valid: true, value: '' };
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) {
    return { valid: false, value: '' };
  }
  return { valid: true, value: value.trim() };
}

function validateBrandBrain(body = {}) {
  const values = {};
  const errors = [];
  for (const [field, limit] of Object.entries(BRAND_BRAIN_LIMITS)) {
    const result = boundedText(body[field], limit);
    values[field] = result.value;
    if (!result.valid) errors.push(field);
  }

  const brandVoice = typeof body.brand_voice === 'string' ? body.brand_voice.trim() : '';
  if (!BRAND_VOICES.has(brandVoice)) errors.push('brand_voice');
  values.brand_voice = BRAND_VOICES.has(brandVoice) ? brandVoice : 'professional';
  if (values.brand_voice === 'custom' && !values.brand_voice_custom) errors.push('brand_voice_custom');
  if (values.brand_voice !== 'custom') values.brand_voice_custom = '';

  return { valid: errors.length === 0, values, errors };
}

function normalizeStoredBrandBrain(brain = {}) {
  if (BRAND_VOICES.has(brain.brand_voice)) return brain;

  const legacyCustomVoice = typeof brain.brand_voice_custom === 'string' && brain.brand_voice_custom.trim()
    ? brain.brand_voice_custom
    : (typeof brain.brand_voice === 'string' ? brain.brand_voice : '');

  return {
    ...brain,
    brand_voice: legacyCustomVoice ? 'custom' : 'professional',
    brand_voice_custom: legacyCustomVoice
  };
}

module.exports = {
  BRAND_BRAIN_LIMITS,
  BRAND_VOICES,
  boundedText,
  normalizeStoredBrandBrain,
  validateBrandBrain
};
