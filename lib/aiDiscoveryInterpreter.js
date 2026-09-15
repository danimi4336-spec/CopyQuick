const { configuredProductionProvider } = require('./openaiProductionProvider');
const { defaultProviderRuntime } = require('./providerRuntime');

const DISCOVERY_OUTPUT_SCHEMA = Object.freeze({
  businessType: 'string',
  industry: 'string',
  category: 'string',
  targetAudience: 'string',
  salesChannel: 'string',
  uncertaintyNotes: 'array',
  suggestedQuestions: 'array'
});

const CONTROLLED_VALUES = Object.freeze({
  businessType: new Set(['physical_product', 'digital_product', 'service', 'software']),
  industry: new Set(['health_wellness', 'education', 'technology', 'automotive', 'home_services', 'professional_services', 'beauty_personal_care']),
  category: new Set(['dietary_supplement', 'auto_detailing', 'coaching', 'consulting', 'online_course', 'ebook', 'beauty_personal_care']),
  salesChannel: new Set(['amazon', 'own_website', 'retail'])
});

function enabled(env = process.env) {
  return String(env.AI_DISCOVERY_ENABLED || '').toLowerCase() === 'true';
}

function compactStrings(value, maximum = 5) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '').trim()).filter(Boolean).slice(0, maximum).map(item => item.slice(0, 240));
}

function normalizeInterpretation(output) {
  const fields = {};
  for (const field of ['businessType', 'industry', 'category', 'salesChannel']) {
    const value = String(output?.[field] || '').trim();
    if (CONTROLLED_VALUES[field].has(value)) fields[field] = value;
  }
  const targetAudience = String(output?.targetAudience || '').trim();
  if (targetAudience && targetAudience.toLowerCase() !== 'unknown') {
    fields.targetAudience = targetAudience.slice(0, 120);
  }
  return {
    fields,
    uncertaintyNotes: compactStrings(output?.uncertaintyNotes),
    suggestedQuestions: compactStrings(output?.suggestedQuestions)
  };
}

function promptFor({ objective, answer }) {
  return [
    'Interpret this founder description for adaptive business discovery.',
    `Objective: ${String(objective || 'launch_product').slice(0, 80)}`,
    `Founder description: ${String(answer || '').slice(0, 2000)}`,
    'Use only these controlled values when applicable:',
    'businessType: physical_product, digital_product, service, software.',
    'industry: health_wellness, education, technology, automotive, home_services, professional_services, beauty_personal_care.',
    'category: dietary_supplement, auto_detailing, coaching, consulting, online_course, ebook, beauty_personal_care.',
    'salesChannel: amazon, own_website, retail.',
    'Use "unknown" rather than guessing. targetAudience must be a concise audience phrase or "unknown".',
    'uncertaintyNotes must identify ambiguities, and suggestedQuestions must ask only high-value clarifying questions.'
  ].join('\n');
}

async function interpretDiscovery({ objective, answer, generatorApi, providerRuntime = defaultProviderRuntime, signal, env = process.env } = {}) {
  if (!enabled(env)) return { mode: 'deterministic', reason: 'AI_DISCOVERY_DISABLED' };
  let provider = generatorApi;
  try {
    provider = provider || configuredProductionProvider(env);
  } catch (error) {
    return { mode: 'deterministic_fallback', reason: String(error?.code || 'AI_PROVIDER_CONFIGURATION_FAILED') };
  }
  if (!provider?.generateStructuredDeliverable) {
    return { mode: 'deterministic_fallback', reason: 'AI_PROVIDER_NOT_CONFIGURED' };
  }
  try {
    const output = await providerRuntime.run({
      operation: 'discovery:interpretation',
      input: { objective, answer },
      signal,
      invoke: ({ signal: providerSignal }) => provider.generateStructuredDeliverable({
        deliverableId: 'discovery_interpretation',
        title: 'Discovery Interpretation',
        prompt: promptFor({ objective, answer }),
        outputSchema: DISCOVERY_OUTPUT_SCHEMA,
        signal: providerSignal
      })
    });
    return {
      mode: 'ai_assisted',
      provider: provider.provider || 'configured',
      model: provider.model || null,
      ...normalizeInterpretation(output)
    };
  } catch (error) {
    return {
      mode: 'deterministic_fallback',
      provider: provider.provider || 'configured',
      model: provider.model || null,
      reason: String(error?.code || 'AI_DISCOVERY_FAILED')
    };
  }
}

module.exports = {
  CONTROLLED_VALUES,
  DISCOVERY_OUTPUT_SCHEMA,
  enabled,
  interpretDiscovery,
  normalizeInterpretation,
  promptFor
};
