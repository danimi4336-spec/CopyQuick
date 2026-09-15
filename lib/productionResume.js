const { getProductionRun } = require('./productionInitialization');
const {
  buildProductionPlanProgress,
  resolveProductionProgressSet,
  serializeProductionPlanProgress
} = require('./productionPlanProgress');
const { productionPlanName } = require('./productionPlanIdentity');
const { getObjective } = require('./objectiveFramework');

const ACTIVE_STATUSES = Object.freeze(['queued', 'running', 'blocked']);
const HISTORY_FILTERS = Object.freeze({
  all: Object.freeze([]),
  active: ACTIVE_STATUSES,
  recoverable: Object.freeze(['failed', 'partially_completed']),
  completed: Object.freeze(['completed'])
});
const HISTORY_PAGE_SIZE = 10;

function actionForStatus(status) {
  if (ACTIVE_STATUSES.includes(status)) return 'Resume Production';
  if (status === 'completed') return 'View Deliverables';
  if (['failed', 'partially_completed'].includes(status)) return 'Review & Recover';
  return 'Review Production';
}

function latestProductionRunId(db, userId) {
  return db.prepare(`
    SELECT id FROM production_runs
    WHERE user_id = ?
    ORDER BY CASE WHEN status IN ('queued', 'running', 'blocked') THEN 0 ELSE 1 END,
             datetime(created_at) DESC, id DESC
    LIMIT 1
  `).get(userId)?.id || null;
}

function summarizeProductionRun(db, ownerId, runId) {
  const production = getProductionRun(db, ownerId, runId);
  if (!production) return null;
  const progressSet = resolveProductionProgressSet({ db, userId: ownerId, production });
  const progress = serializeProductionPlanProgress(buildProductionPlanProgress({
    db, userId: ownerId, production, approvedProductionSet: progressSet
  }));
  return {
    id: production.id,
    href: `/production/${production.id}`,
    status: production.status,
    statusLabel: String(production.status || '').replace(/_/g, ' '),
    objectiveLabel: getObjective(production.objective)?.title || 'Guided Objective',
    planName: productionPlanName(production, progressSet),
    actionLabel: actionForStatus(production.status),
    progress,
    batchCompletedCount: production.jobs.filter(job => job.status === 'completed').length,
    batchTotalCount: production.jobs.length,
    createdAt: production.created_at,
    completedAt: production.completed_at
  };
}

function getLatestProductionResume(db, userId) {
  const ownerId = Number(userId);
  if (!db || !Number.isSafeInteger(ownerId) || ownerId <= 0) return null;
  const runId = latestProductionRunId(db, ownerId);
  return runId ? summarizeProductionRun(db, ownerId, runId) : null;
}

function listProductionResumes(db, userId, limit = 20) {
  const ownerId = Number(userId);
  const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  if (!db || !Number.isSafeInteger(ownerId) || ownerId <= 0) return [];
  return db.prepare(`
    SELECT id FROM production_runs
    WHERE user_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(ownerId, boundedLimit)
    .map(row => summarizeProductionRun(db, ownerId, row.id))
    .filter(Boolean);
}

function listProductionHistoryPage(db, userId, options = {}) {
  const ownerId = Number(userId);
  const requestedPage = Number(options.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const status = Object.hasOwn(HISTORY_FILTERS, options.status) ? options.status : 'all';
  if (!db || !Number.isSafeInteger(ownerId) || ownerId <= 0) {
    return { items: [], page: 1, totalPages: 1, totalCount: 0, status };
  }
  const statuses = HISTORY_FILTERS[status];
  const statusClause = statuses.length ? `AND status IN (${statuses.map(() => '?').join(', ')})` : '';
  const parameters = [ownerId, ...statuses];
  const totalCount = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM production_runs
    WHERE user_id = ? ${statusClause}
  `).get(...parameters).count);
  const totalPages = Math.max(Math.ceil(totalCount / HISTORY_PAGE_SIZE), 1);
  const currentPage = Math.min(page, totalPages);
  const ids = db.prepare(`
    SELECT id FROM production_runs
    WHERE user_id = ? ${statusClause}
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...parameters, HISTORY_PAGE_SIZE, (currentPage - 1) * HISTORY_PAGE_SIZE);
  return {
    items: ids.map(row => summarizeProductionRun(db, ownerId, row.id)).filter(Boolean),
    page: currentPage,
    totalPages,
    totalCount,
    status
  };
}

module.exports = {
  ACTIVE_STATUSES,
  HISTORY_FILTERS,
  HISTORY_PAGE_SIZE,
  actionForStatus,
  getLatestProductionResume,
  latestProductionRunId,
  listProductionHistoryPage,
  listProductionResumes,
  summarizeProductionRun
};
