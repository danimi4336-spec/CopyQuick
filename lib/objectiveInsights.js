const UNRESOLVED_VALUES = new Set([
  '', 'unsure', 'unknown', "i'm not sure yet", 'not established', 'needs confirmation', 'unresolved'
]);

const PERMITTED_USES = Object.freeze({
  business_objective: ['strategy', 'planning', 'measurement'],
  customer_motivation: ['strategy', 'positioning', 'public_copy'],
  customer_need: ['strategy', 'positioning', 'public_copy'],
  current_channel: ['strategy', 'diagnosis'],
  recommended_channel: ['strategy', 'planning'],
  conversion_action: ['strategy', 'planning', 'public_copy'],
  observed_friction: ['strategy', 'diagnosis'],
  hypothesis: ['strategy', 'planning', 'conditional_guidance'],
  confirmed_offer_fact: ['strategy', 'planning', 'public_copy'],
  exploration_intent: ['strategy', 'planning', 'hypothesis'],
  unresolved_input: ['strategy', 'planning', 'diagnosis'],
  customer_facing_cta: ['planning', 'public_copy'],
  measurement_goal: ['planning', 'measurement'],
  search_goal: ['strategy', 'planning', 'measurement'],
  topic_territory: ['strategy', 'planning', 'public_copy']
});

function normalized(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function isUnresolvedValue(value) {
  return value === null || value === undefined || UNRESOLVED_VALUES.has(normalized(value).toLowerCase());
}

function sourceValue(understanding, key) {
  const field = understanding?.[key];
  if (!field) return { value: null, field: null };
  return { value: field.label || field.value, field };
}

function provenanceFor(field) {
  if (!field || field.source === 'unknown' || isUnresolvedValue(field.value)) return 'unresolved';
  if (field.semanticRole === 'exploration_intent') return 'exploration_intent';
  return ['user_confirmed', 'remembered_confirmed'].includes(field.source) ? 'confirmed_fact' : 'inferred_fact';
}

function insight(concept, value, {
  provenance = 'unresolved', sourceFields = [], objectiveScope = null, permittedUses = null
} = {}) {
  const unresolved = isUnresolvedValue(value) || provenance === 'unresolved';
  return Object.freeze({
    concept: unresolved ? 'unresolved_input' : concept,
    intendedConcept: concept,
    value: unresolved ? null : normalized(value),
    label: unresolved ? 'Not established' : normalized(value),
    provenance: unresolved ? 'unresolved' : provenance,
    objectiveScope,
    permittedUses: Object.freeze([...(unresolved ? PERMITTED_USES.unresolved_input : (permittedUses || PERMITTED_USES[concept] || ['strategy']))]),
    sourceFields: Object.freeze([...sourceFields]),
    unresolved
  });
}

function fromField(understanding, key, concept, objectiveScope) {
  const { value, field } = sourceValue(understanding, key);
  return insight(concept, value, { provenance: provenanceFor(field), sourceFields: [key], objectiveScope });
}

function buildObjectiveInsights({ objective, understanding = {}, answers = {} }) {
  const result = {
    businessObjective: insight('business_objective', null, { objectiveScope: objective }),
    customerMotivation: fromField(understanding, 'customerMotivation', 'customer_motivation', objective),
    customerNeed: fromField(understanding, 'customerNeed', 'customer_need', objective),
    currentChannel: insight('current_channel', null, { objectiveScope: objective }),
    recommendedChannel: insight('recommended_channel', null, { objectiveScope: objective }),
    conversionAction: insight('conversion_action', null, { objectiveScope: objective }),
    observedFriction: insight('observed_friction', null, { objectiveScope: objective }),
    confirmedOfferFact: insight('confirmed_offer_fact', null, { objectiveScope: objective }),
    customerFacingCta: fromField(understanding, 'primaryCta', 'customer_facing_cta', objective),
    measurementGoal: insight('measurement_goal', null, { objectiveScope: objective }),
    searchGoal: insight('search_goal', null, { objectiveScope: objective }),
    topicTerritory: insight('topic_territory', null, { objectiveScope: objective }),
    rawBuilderDescription: insight('confirmed_offer_fact', answers.initial_description, {
      provenance: 'builder_provided_context', sourceFields: ['initial_description'], objectiveScope: objective,
      permittedUses: ['interpretation', 'traceability', 'strategy_context']
    })
  };

  if (objective === 'get_more_customers') {
    result.businessObjective = fromField(understanding, 'acquisitionGoal', 'business_objective', objective);
    if (/predictab\w*.*qualified.*(?:local\s+)?leads?/i.test(String(answers.initial_description || ''))) {
      result.businessObjective = insight('business_objective', 'Create a more predictable source of qualified local leads', {
        provenance: 'confirmed_fact', sourceFields: ['initial_description', 'acquisitionGoal'], objectiveScope: objective
      });
    }
    result.currentChannel = fromField(understanding, 'currentAcquisitionChannel', 'current_channel', objective);
    result.recommendedChannel = fromField(understanding, 'recommendedChannel', 'recommended_channel', objective);
    result.measurementGoal = fromField(understanding, 'acquisitionGoal', 'measurement_goal', objective);
    result.conversionAction = fromField(understanding, 'salesProcess', 'conversion_action', objective);
  } else if (objective === 'increase_conversion_rates') {
    result.conversionAction = fromField(understanding, 'funnelType', 'conversion_action', objective);
    const action = understanding.funnelType?.value;
    const actionLanguage = action === 'booked_call' ? { objective: 'Improve booked-consultation conversion', measurement: 'Completed consultation bookings' }
      : action === 'lead_form' ? { objective: 'Improve lead-form conversion', measurement: 'Completed lead-form submissions' }
        : action === 'trial_signup' ? { objective: 'Improve trial-start conversion', measurement: 'Completed trial starts' }
          : action === 'contact' ? { objective: 'Improve contact conversion', measurement: 'Completed customer contacts' }
            : action === 'purchase' ? { objective: 'Improve purchase conversion', measurement: 'Completed purchase conversion' }
              : { objective: 'Improve the established conversion path', measurement: 'Completed conversion action' };
    result.businessObjective = insight('business_objective', actionLanguage.objective, {
      provenance: 'strategic_recommendation', sourceFields: ['objective'], objectiveScope: objective
    });
    result.currentChannel = fromField(understanding, 'trafficSource', 'current_channel', objective);
    result.observedFriction = fromField(understanding, 'conversionFriction', 'observed_friction', objective);
    result.confirmedOfferFact = fromField(understanding, 'currentOffer', 'confirmed_offer_fact', objective);
    result.measurementGoal = insight('measurement_goal', actionLanguage.measurement, {
      provenance: 'strategic_recommendation', sourceFields: ['objective', 'funnelType'], objectiveScope: objective
    });
  } else if (objective === 'improve_search_rankings') {
    result.businessObjective = fromField(understanding, 'searchGoal', 'business_objective', objective);
    result.searchGoal = fromField(understanding, 'searchGoal', 'search_goal', objective);
    result.topicTerritory = fromField(understanding, 'suppliedKeywords', 'topic_territory', objective);
    result.confirmedOfferFact = fromField(understanding, 'websiteContext', 'confirmed_offer_fact', objective);
    result.currentChannel = insight('current_channel', 'Organic search', {
      provenance: 'confirmed_fact', sourceFields: ['objective'], objectiveScope: objective
    });
    result.measurementGoal = insight('measurement_goal', 'Relevant organic visibility and content-assisted action', {
      provenance: 'strategic_recommendation', sourceFields: ['searchGoal'], objectiveScope: objective
    });
  }

  const exploration = understanding.productExplorationDirections;
  if (exploration) {
    result.explorationIntent = insight('exploration_intent', exploration.label || exploration.value, {
      provenance: exploration.semanticRole === 'exploration_intent' ? 'exploration_intent' : provenanceFor(exploration),
      sourceFields: ['productExplorationDirections'], objectiveScope: objective
    });
  }
  return Object.freeze(result);
}

function insightValue(insights, key) {
  const item = insights?.[key];
  return item && !item.unresolved ? item.value : null;
}

function publicEligible(item) {
  return Boolean(item && !item.unresolved && item.permittedUses?.includes('public_copy'));
}

function semanticSummary(insights = {}) {
  return Object.entries(insights).map(([key, item]) => {
    if (key === 'rawBuilderDescription') return null;
    if (!item?.intendedConcept) return null;
    const label = item.intendedConcept.replace(/_/g, ' ');
    return `${label}: ${item.unresolved ? 'Not established' : item.value} (${item.provenance})`;
  }).filter(Boolean).join('\n');
}

function dependencySemanticPayload(insights = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(insights).map(([key, item]) => [key, Object.freeze({
    concept: item.intendedConcept,
    value: item.value,
    provenance: item.provenance,
    unresolved: item.unresolved,
    permittedUses: item.permittedUses
  })])));
}

module.exports = { PERMITTED_USES, buildObjectiveInsights, dependencySemanticPayload, insight, insightValue, isUnresolvedValue, publicEligible, semanticSummary };
