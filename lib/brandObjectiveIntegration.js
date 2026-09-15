const { validateBrandBrain } = require('./brandBrainValidation');

const BRAND_BRAIN_FIELDS = Object.freeze([
  'business_name', 'industry', 'target_audience', 'brand_voice', 'brand_voice_custom',
  'unique_value', 'competitors', 'goals', 'key_messages'
]);

function clean(value, max = 1000) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function joined(value, max = 1000) {
  return Array.isArray(value) ? clean(value.filter(Boolean).join('\n'), max) : clean(value, max);
}

function buildBrandBrainProposal({ existing = {}, understanding = {}, outputs = {} }) {
  const positioning = outputs.product_positioning || {};
  const value = outputs.value_proposition || {};
  const messaging = outputs.core_messaging || {};
  const candidates = {
    target_audience: clean(understanding.targetAudience?.label || understanding.targetAudience?.value || outputs.customer_profile?.primaryCustomer, 500),
    brand_voice: 'custom',
    brand_voice_custom: clean(understanding.brandVoice?.label || understanding.brandVoice?.value || messaging.toneGuidance, 300),
    unique_value: clean(value.primaryValueProposition || positioning.positioningStatement),
    goals: clean(understanding.brandBusiness?.label || understanding.brandBusiness?.value),
    key_messages: joined(messaging.messagePillars || value.supportingMessages)
  };
  return Object.fromEntries(Object.entries(candidates).filter(([, proposed]) => proposed).map(([field, proposed]) => {
    const current = clean(existing[field], field === 'target_audience' ? 500 : field === 'brand_voice_custom' ? 300 : 1000);
    return [field, { field, current, proposed, status: current ? (current === proposed ? 'unchanged' : 'conflict_requires_approval') : 'available_to_enrich', source: 'approved_build_brand_output' }];
  }));
}

function loadBrandObjectiveProposal(db, { userId, productionRunId, existing = {} }) {
  const runId = Number(productionRunId);
  if (!Number.isSafeInteger(runId) || runId <= 0) return null;
  const run = db.prepare(`
    SELECT id FROM production_runs
    WHERE id = ? AND user_id = ? AND objective = 'build_brand' AND status = 'completed'
  `).get(runId, userId);
  if (!run) return null;
  const rows = db.prepare(`
    SELECT pj.deliverable_id, g.structured_result
    FROM production_jobs pj
    JOIN generations g ON g.id = pj.generation_id AND g.user_id = ? AND g.is_deleted = 0
    WHERE pj.production_run_id = ? AND pj.status = 'completed'
  `).all(userId, runId);
  const outputs = {};
  for (const row of rows) {
    try { outputs[row.deliverable_id] = JSON.parse(row.structured_result || '{}'); }
    catch (_) { /* A malformed historical result is not eligible for enrichment. */ }
  }
  return { productionRunId: runId, proposal: buildBrandBrainProposal({ existing, outputs }) };
}

function applyApprovedBrandBrainProposal({ existing = {}, proposal = {}, approvedFields = [] }) {
  const approved = new Set(approvedFields);
  const values = { ...existing };
  for (const field of BRAND_BRAIN_FIELDS) {
    if (!approved.has(field) || !proposal[field]?.proposed) continue;
    values[field] = proposal[field].proposed;
  }
  const validation = validateBrandBrain(values);
  if (!validation.valid) {
    const error = new Error('Approved Brand Brain enrichment is invalid.');
    error.code = 'BRAND_BRAIN_ENRICHMENT_INVALID';
    error.fields = validation.errors;
    throw error;
  }
  return validation.values;
}

module.exports = { BRAND_BRAIN_FIELDS, buildBrandBrainProposal, applyApprovedBrandBrainProposal, loadBrandObjectiveProposal };
