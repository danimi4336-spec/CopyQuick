const ALLOWED_METADATA_KEYS = new Set([
  'contractVersion', 'delaySeconds', 'reasonCode', 'reversalEventId', 'recoveryType'
]);

function safeMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata).filter(function([key, value]) {
    return ALLOWED_METADATA_KEYS.has(key)
      && ['string', 'number', 'boolean'].includes(typeof value);
  }));
}

function recordProductionJobEvent(db, {
  productionRunId,
  productionJobId,
  eventType,
  fromStatus = null,
  toStatus = null,
  attemptNumber = 0,
  metadata = {}
}) {
  return db.prepare(`
    INSERT INTO production_job_events (
      production_run_id, production_job_id, event_type, from_status, to_status,
      attempt_number, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    productionRunId, productionJobId, eventType, fromStatus, toStatus,
    attemptNumber, JSON.stringify(safeMetadata(metadata))
  ).lastInsertRowid;
}

module.exports = { recordProductionJobEvent, safeMetadata };
