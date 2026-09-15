const REQUIRED_OBJECTIVE_CAPABILITIES = Object.freeze([
  'discovery',
  'strategy',
  'buildPlan',
  'production',
  'generation',
  'validation',
  'presentation',
  'persistence',
  'acceptance'
]);
const OBJECTIVE_CATALOG_VERSION = 1;

function completeJourney(overrides = {}) {
  return Object.freeze({
    discovery: Object.freeze({ policy: 'adaptive_requirements' }),
    strategy: Object.freeze({ policy: 'evidence_disciplined_strategy' }),
    buildPlan: Object.freeze({ policy: 'dependency_ordered_plan' }),
    production: Object.freeze({ policy: 'registered_contracts' }),
    generation: Object.freeze({ policy: 'bounded_generation_context' }),
    validation: Object.freeze({ policy: 'contract_and_quality_validation' }),
    presentation: Object.freeze({ policy: 'structured_deliverable_sections' }),
    persistence: Object.freeze({ policy: 'owned_saved_plan_and_production_history' }),
    acceptance: Object.freeze({ policy: 'deterministic_provider_isolation' }),
    ...overrides
  });
}

const OBJECTIVE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'launch_product', available: true, icon: '🚀', title: 'Launch a New Product',
    description: 'Bring a new offer to market with a clear, coordinated plan.',
    outcome: 'Create a complete launch strategy including positioning, messaging, marketing assets and recommended next steps.',
    planName: 'Product Launch Plan', journey: completeJourney({
      discovery: Object.freeze({ policy: 'launch_product_adaptive_requirements' }),
      strategy: Object.freeze({ policy: 'launch_product_evidence_strategy' }),
      buildPlan: Object.freeze({ policy: 'maturity_aware_product_plan' })
    })
  }),
  Object.freeze({
    id: 'get_more_customers', available: true, icon: '👥', title: 'Get More Customers',
    description: 'Build a practical path to attract and win more buyers.',
    outcome: 'Identify the strongest acquisition opportunities and create the campaigns, messages and next steps to turn prospects into customers.',
    planName: 'Customer Growth Plan', journey: completeJourney({
      discovery: Object.freeze({ policy: 'customer_acquisition_requirements' }),
      strategy: Object.freeze({ policy: 'customer_acquisition_evidence_strategy' }),
      buildPlan: Object.freeze({ policy: 'customer_acquisition_plan' })
    })
  }),
  Object.freeze({ id: 'increase_conversion_rates', available: true, icon: '📈', title: 'Increase Conversion Rates', description: 'Turn more of your existing traffic into customers.', outcome: 'Strengthen your offer, sales messaging and customer journey so more visitors take the next step.', planName: 'Conversion Improvement Plan', journey: completeJourney({
    discovery: Object.freeze({ policy: 'conversion_diagnostic_requirements' }),
    strategy: Object.freeze({ policy: 'conversion_evidence_strategy' }),
    buildPlan: Object.freeze({ policy: 'conversion_improvement_plan' })
  }) }),
  Object.freeze({ id: 'improve_search_rankings', available: true, icon: '🔍', title: 'Improve Search Rankings', description: 'Grow discoverability with a focused search strategy.', outcome: 'Clarify priority search opportunities and build optimized content and messaging that help the right customers find you.', planName: 'Search Growth Plan', journey: completeJourney({
    discovery: Object.freeze({ policy: 'search_evidence_requirements' }),
    strategy: Object.freeze({ policy: 'search_evidence_strategy' }),
    buildPlan: Object.freeze({ policy: 'search_growth_plan' })
  }) }),
  Object.freeze({ id: 'build_brand', available: true, icon: '✨', title: 'Build My Brand', description: 'Create a distinctive brand customers recognize and trust.', outcome: 'Define your positioning, voice and core story, then translate them into consistent messaging across your business.', planName: 'Brand Development Plan', journey: completeJourney({
    discovery: Object.freeze({ policy: 'brand_foundation_requirements' }), strategy: Object.freeze({ policy: 'brand_evidence_strategy' }),
    buildPlan: Object.freeze({ policy: 'brand_development_plan' }), persistence: Object.freeze({ policy: 'explicit_brand_brain_enrichment' })
  }) }),
  Object.freeze({ id: 'promote_service', available: true, icon: '💼', title: 'Promote My Service', description: 'Present your expertise clearly and win better-fit clients.', outcome: 'Shape a compelling service offer and create the sales, outreach and trust-building assets needed to attract clients.', planName: 'Service Promotion Plan', journey: completeJourney({ discovery: Object.freeze({ policy: 'service_promotion_requirements' }), strategy: Object.freeze({ policy: 'service_evidence_strategy' }), buildPlan: Object.freeze({ policy: 'service_promotion_plan' }) }) }),
  Object.freeze({ id: 'validate_idea', available: true, icon: '💡', title: 'Validate My Idea', description: 'Test demand before investing significant time or money.', outcome: 'Clarify your audience, value proposition and validation plan so you can gather evidence and make a confident go-or-adjust decision.', planName: 'Idea Validation Plan', journey: completeJourney({ discovery: Object.freeze({ policy: 'idea_validation_requirements' }), strategy: Object.freeze({ policy: 'hypothesis_evidence_strategy' }), buildPlan: Object.freeze({ policy: 'idea_validation_plan' }), validation: Object.freeze({ policy: 'evidence_threshold_validation' }) }) }),
  Object.freeze({ id: 'more_objectives', available: false, catalogKind: 'expansion_notice', icon: '➕', title: 'More Objectives', description: 'Explore additional ways to build, grow or promote.', outcome: 'Additional guided objective workflows are planned.', planName: null, journey: null })
]);

function hasCompleteJourney(definition) {
  return Boolean(definition?.journey && REQUIRED_OBJECTIVE_CAPABILITIES.every(function(capability) {
    const contract = definition.journey[capability];
    return contract && typeof contract.policy === 'string' && contract.policy.trim();
  }));
}

function getObjective(id) {
  return OBJECTIVE_DEFINITIONS.find(objective => objective.id === id) || null;
}

function getAvailableObjective(id) {
  const objective = getObjective(id);
  return objective?.catalogKind !== 'expansion_notice' && objective?.available && hasCompleteJourney(objective) ? objective : null;
}

function validateObjectiveCatalog(definitions = OBJECTIVE_DEFINITIONS) {
  const ids = new Set();
  const errors = [];
  definitions.forEach(function(definition) {
    if (!definition || !/^[a-z][a-z0-9_]*$/.test(definition.id || '')) errors.push('invalid_id');
    else if (ids.has(definition.id)) errors.push(`duplicate_id:${definition.id}`);
    else ids.add(definition.id);
    if (!definition?.title || !definition?.description || !definition?.outcome) errors.push(`incomplete_metadata:${definition?.id || 'unknown'}`);
    if (definition?.available && !hasCompleteJourney(definition)) errors.push(`incomplete_available_journey:${definition.id}`);
    if (definition?.available && !definition?.planName) errors.push(`missing_plan_name:${definition.id}`);
    if (definition?.catalogKind === 'expansion_notice' && definition.available) errors.push(`expansion_notice_available:${definition.id}`);
  });
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

const catalogValidation = validateObjectiveCatalog();
if (!catalogValidation.valid) throw new Error(`Invalid objective catalog: ${catalogValidation.errors.join(', ')}`);

function assertAvailableObjective(id) {
  const objective = getAvailableObjective(id);
  if (objective) return objective;
  const error = new Error('A complete supported objective is required.');
  error.code = 'OBJECTIVE_JOURNEY_UNAVAILABLE';
  throw error;
}

const objectiveUniverse = OBJECTIVE_DEFINITIONS.map(function(objective) {
  return Object.freeze({
    id: objective.id,
    available: Boolean(getAvailableObjective(objective.id)),
    catalogKind: objective.catalogKind || 'objective',
    availabilityStatus: getAvailableObjective(objective.id) ? 'available' : 'planned',
    icon: objective.icon,
    title: objective.title,
    description: objective.description,
    outcome: objective.outcome
  });
});

module.exports = {
  OBJECTIVE_DEFINITIONS,
  OBJECTIVE_CATALOG_VERSION,
  REQUIRED_OBJECTIVE_CAPABILITIES,
  assertAvailableObjective,
  getAvailableObjective,
  getObjective,
  hasCompleteJourney,
  objectiveUniverse,
  validateObjectiveCatalog
};
