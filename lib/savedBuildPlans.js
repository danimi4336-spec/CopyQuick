const { planFingerprint, validateSelection } = require('./buildPlanApproval');

const STATE_VERSION = 1;
const RESUMABLE_STATUSES = Object.freeze(['saved', 'active', 'partially_completed']);
const MAX_STATE_BYTES = 512 * 1024;

function savedPlanError(code) {
  const error = new Error('The saved plan could not be restored safely.');
  error.code = code;
  return error;
}

function safeUserId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function productDescription(discoverySession) {
  return String(discoverySession?.answers?.initial_description || '').trim().slice(0, 2000);
}

function resumableWorkflowState(discoverySession) {
  const allowed = [
    'objective', 'answers', 'understanding', 'unknowns', 'completedQuestions', 'completion',
    'knowledgeDomains', 'nextQuestion', 'remainingKnowledgeGaps', 'planningReadiness',
    'discoveryCompleteForNow', 'discoveryPolicyVersion', 'startedAt', 'updatedAt',
    'reflectionStartedAt', 'planningConfirmedAt', 'confirmedUnderstanding', 'strategyResult',
    'strategyUpdatedAt', 'buildPlan', 'buildPlanUpdatedAt', 'buildPlanSource',
    'buildPlanFingerprint', 'buildPlanSelection'
  ];
  return Object.fromEntries(allowed
    .filter(key => discoverySession?.[key] !== undefined)
    .map(key => [key, discoverySession[key]]));
}

function validateWorkflowState(state, expectedFingerprint) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  if (!['launch_product', 'get_more_customers'].includes(state.objective) || !state.answers || !state.buildPlan || !state.buildPlanSelection) return false;
  if (!state.confirmedUnderstanding || !state.strategyResult || !state.planningConfirmedAt || !state.strategyUpdatedAt) return false;
  if (state.buildPlanFingerprint !== expectedFingerprint || planFingerprint(state.buildPlan) !== expectedFingerprint) return false;
  const selection = validateSelection(state.buildPlan, state.buildPlanSelection);
  return selection.valid && state.buildPlanSelection.planFingerprint === expectedFingerprint;
}

function parseSavedPlan(row) {
  if (!row || row.state_version !== STATE_VERSION) throw savedPlanError('SAVED_PLAN_VERSION_UNSUPPORTED');
  let state;
  try { state = JSON.parse(row.workflow_state); }
  catch (_) { throw savedPlanError('SAVED_PLAN_STATE_INVALID'); }
  if (!validateWorkflowState(state, row.plan_fingerprint)) throw savedPlanError('SAVED_PLAN_STATE_INVALID');
  return {
    id: row.id,
    objective: row.objective,
    description: row.description,
    status: row.status,
    planFingerprint: row.plan_fingerprint,
    stateVersion: row.state_version,
    savedAt: row.saved_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    state
  };
}

function saveBuildPlan(db, { userId, discoverySession, now = new Date() }) {
  const ownerId = safeUserId(userId);
  if (!ownerId || !validateWorkflowState(discoverySession, discoverySession?.buildPlanFingerprint)) {
    throw savedPlanError('SAVED_PLAN_STATE_INVALID');
  }
  const description = productDescription(discoverySession);
  if (!description) throw savedPlanError('SAVED_PLAN_DESCRIPTION_REQUIRED');
  const state = resumableWorkflowState(discoverySession);
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) throw savedPlanError('SAVED_PLAN_STATE_TOO_LARGE');
  const timestamp = now.toISOString();
  db.prepare(`
    INSERT INTO saved_build_plan_states (
      user_id, objective, description, status, plan_fingerprint, state_version,
      workflow_state, saved_at, updated_at, completed_at
    ) VALUES (?, ?, ?, 'saved', ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(user_id, objective) DO UPDATE SET
      description = excluded.description,
      status = 'saved',
      plan_fingerprint = excluded.plan_fingerprint,
      state_version = excluded.state_version,
      workflow_state = excluded.workflow_state,
      saved_at = excluded.saved_at,
      updated_at = excluded.updated_at,
      completed_at = NULL
  `).run(ownerId, state.objective, description, state.buildPlanFingerprint, STATE_VERSION, serialized, timestamp, timestamp);
  return getSavedPlan(db, { userId: ownerId, objective: state.objective, includeNonResumable: true });
}

function rawSavedPlan(db, { userId, objective = 'launch_product', includeNonResumable = false }) {
  const ownerId = safeUserId(userId);
  if (!ownerId) return null;
  const statuses = includeNonResumable ? '' : `AND status IN (${RESUMABLE_STATUSES.map(() => '?').join(', ')})`;
  return db.prepare(`
    SELECT * FROM saved_build_plan_states
    WHERE user_id = ? AND objective = ? ${statuses}
    ORDER BY updated_at DESC LIMIT 1
  `).get(ownerId, objective, ...(!includeNonResumable ? RESUMABLE_STATUSES : []));
}

function invalidateSavedPlan(db, userId, id) {
  db.prepare(`
    UPDATE saved_build_plan_states SET status = 'invalidated', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(id, safeUserId(userId));
}

function getSavedPlan(db, options) {
  const row = rawSavedPlan(db, options);
  if (!row) return null;
  try { return parseSavedPlan(row); }
  catch (error) {
    invalidateSavedPlan(db, options.userId, row.id);
    return null;
  }
}

function resumeSavedPlan(db, { userId, objective = 'launch_product' }) {
  const plan = getSavedPlan(db, { userId, objective });
  if (!plan) return { valid: false, reason: 'No resumable saved plan is available.' };
  db.prepare(`
    UPDATE saved_build_plan_states SET status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND status IN ('saved', 'active', 'partially_completed')
  `).run(plan.id, safeUserId(userId));
  return { valid: true, plan: { ...plan, status: 'active' }, discoverySession: plan.state };
}

function syncSavedPlanLifecycle(db, { userId, planFingerprint: fingerprint }) {
  const row = rawSavedPlan(db, { userId, includeNonResumable: true });
  if (!row || row.plan_fingerprint !== fingerprint || row.status === 'invalidated') return null;
  let plan;
  try { plan = parseSavedPlan(row); }
  catch (_) { invalidateSavedPlan(db, userId, row.id); return null; }
  const selectedIds = plan.state.buildPlanSelection.selectedDeliverableIds;
  const completedIds = new Set(db.prepare(`
    SELECT DISTINCT production_jobs.deliverable_id AS id
    FROM production_jobs JOIN production_runs ON production_runs.id = production_jobs.production_run_id
    WHERE production_runs.user_id = ? AND production_runs.plan_fingerprint = ?
      AND production_jobs.status = 'completed'
  `).all(safeUserId(userId), fingerprint).map(item => item.id));
  const completedCount = selectedIds.filter(id => completedIds.has(id)).length;
  const status = completedCount === selectedIds.length && selectedIds.length
    ? 'completed' : completedCount > 0 ? 'partially_completed' : row.status;
  db.prepare(`
    UPDATE saved_build_plan_states
    SET status = ?, updated_at = CURRENT_TIMESTAMP,
        completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id = ? AND user_id = ?
  `).run(status, status, row.id, safeUserId(userId));
  return { status, completedCount, totalCount: selectedIds.length };
}

module.exports = {
  MAX_STATE_BYTES,
  RESUMABLE_STATUSES,
  STATE_VERSION,
  getSavedPlan,
  parseSavedPlan,
  productDescription,
  resumeSavedPlan,
  resumableWorkflowState,
  saveBuildPlan,
  syncSavedPlanLifecycle,
  validateWorkflowState
};
