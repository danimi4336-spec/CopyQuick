function buildProductionDelivery(jobs = []) {
  const needsAttention = jobs.filter(job => ['NEEDS_INFORMATION', 'NEEDS_SAFE_REVIEW', 'COULD_NOT_COMPLETE', 'NOT_CREATED'].includes(job.readiness));
  const readyForReview = jobs.filter(job => job.readiness === 'READY_FOR_REVIEW');
  const researchSources = jobs.filter(job => job.deliverable_id === 'research_evidence_pack' && !needsAttention.includes(job));
  const strategyPlanning = jobs.filter(job => job.artifactPolicy?.role === 'planning_foundation'
    && job.deliverable_id !== 'research_evidence_pack'
    && !needsAttention.includes(job));
  const recommended = readyForReview[0] || needsAttention[0] || researchSources[0] || strategyPlanning[0] || null;
  return {
    readyForReview,
    needsAttention,
    researchSources,
    strategyPlanning,
    recommended,
    supportingCount: researchSources.concat(strategyPlanning).filter(job => job.status === 'completed' && job.readiness === 'AVAILABLE').length
  };
}

module.exports = { buildProductionDelivery };
