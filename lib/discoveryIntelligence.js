const { evaluateRequirements, requirementsFor } = require('./discoveryRequirements');

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function fieldConfidence(field) {
  if (!field || field.value === null || field.value === 'unsure' || field.source === 'unknown') return 0;
  return clampConfidence(field.confidence);
}

function statusForConfidence(confidence) {
  if (confidence >= 0.7) return 'known';
  if (confidence > 0) return 'partial';
  return 'unknown';
}

function analyzeDiscovery({ objective, understanding = {}, unknowns = [], answers = {} }) {
  const evaluation = evaluateRequirements({ objective, understanding, answers });
  const definitions = requirementsFor({ objective, understanding });
  const knowledgeDomains = {};
  const reasoning = [];
  let knownWeight = 0;
  let totalWeight = 0;

  evaluation.requirements.forEach(function(item) {
    const definition = definitions.find(function(candidate) { return candidate.id === item.id; });
    const confidence = Math.max(0, ...definition.fields.map(function(field) { return fieldConfidence(understanding[field]); }));
    const existing = knowledgeDomains[item.domain];
    const domainConfidence = existing ? Math.max(existing.confidence, confidence) : confidence;
    knowledgeDomains[item.domain] = {
      score: Math.round(domainConfidence * 100),
      importance: Math.max(existing?.importance || 0, definition.importance),
      confidence: Number(domainConfidence.toFixed(2)),
      status: statusForConfidence(domainConfidence),
      requirementStates: [...(existing?.requirementStates || []), { id: item.id, state: item.state }]
    };
    totalWeight += definition.importance;
    if (item.state === 'known') knownWeight += definition.importance;
    reasoning.push({
      requirementId: item.id,
      state: item.state,
      reason: item.state === 'known'
        ? 'Already understood from previous answers.'
        : item.state === 'unasked'
          ? 'Useful knowledge has not been established yet.'
          : 'The question was answered explicitly, but the knowledge remains unresolved.'
    });
  });

  if (evaluation.nextQuestion) {
    reasoning.push({
      selectedRequirement: evaluation.nextQuestion.requirementId,
      reason: 'Highest-value applicable unanswered question whose prerequisites are established.',
      priority: evaluation.nextQuestion.importance
    });
  }

  const unresolvedRequiredDomains = Array.from(new Set([
    ...evaluation.unresolvedBlockingRequirements,
    ...evaluation.unaskedEssentialRequirements
  ].map(function(item) { return item.domain; })));
  const unsatisfiedRequiredDomains = evaluation.unaskedEssentialRequirements.map(function(item) { return item.domain; });

  return {
    completion: totalWeight ? Math.round((knownWeight / totalWeight) * 100) : 0,
    knowledgeDomains,
    nextQuestion: evaluation.nextQuestion,
    discoveryCompleteForNow: evaluation.discoveryCompleteForNow,
    reasoning,
    planningReadiness: {
      policyVersion: evaluation.policyVersion,
      ready: evaluation.ready,
      discoveryCompleteForNow: evaluation.discoveryCompleteForNow,
      requirements: evaluation.requirements,
      answeredRequirements: evaluation.answeredRequirements,
      knownRequirements: evaluation.knownRequirements,
      unresolvedBlockingRequirements: evaluation.unresolvedBlockingRequirements,
      unresolvedNonBlockingRequirements: evaluation.unresolvedNonBlockingRequirements,
      unaskedEssentialRequirements: evaluation.unaskedEssentialRequirements,
      optionalKnowledgeGaps: evaluation.optionalKnowledgeGaps,
      requiredDomains: evaluation.requirements.filter(function(item) { return item.essential; }).map(function(item) { return item.domain; }),
      satisfiedRequiredDomains: evaluation.requirements.filter(function(item) { return item.essential && item.state === 'known'; }).map(function(item) { return item.domain; }),
      unsatisfiedRequiredDomains,
      unresolvedRequiredDomains,
      optionalDomains: evaluation.requirements.filter(function(item) { return !item.essential; }).map(function(item) { return item.domain; })
    },
    remainingKnowledgeGaps: Array.from(new Set(evaluation.requirements
      .filter(function(item) { return item.state !== 'known'; })
      .map(function(item) { return item.domain; })))
  };
}

module.exports = { analyzeDiscovery };
