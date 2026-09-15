const { assertAvailableObjective } = require('./objectiveFramework');
const { analyzeDiscovery } = require('./discoveryIntelligence');
const { requirementsFor } = require('./discoveryRequirements');
const { buildStrategy } = require('./strategyEngine');
const { buildStrategyWithAI } = require('./aiStrategySynthesis');
const { buildPlan } = require('./buildPlanEngine');
const { getProductionContract } = require('./productionContracts');
const { getProductionArtifactPolicy } = require('./productionArtifactPolicy');
const { generateDeliverable } = require('./generationService');
const { validateCustomerReadyOutput } = require('./productionQuality');

function assertPlanContracts(plan) {
  const items = (plan?.phases || []).flatMap(phase => phase.deliverables || []);
  for (const item of items) {
    if (!getProductionContract(item.id) || !getProductionArtifactPolicy(item.id)) {
      const error = new Error('The objective produced an unregistered deliverable.');
      error.code = 'OBJECTIVE_DELIVERABLE_UNREGISTERED';
      throw error;
    }
  }
  return plan;
}

function createObjectiveRuntime(objectiveId) {
  const definition = assertAvailableObjective(objectiveId);
  return Object.freeze({
    definition,
    discovery: Object.freeze({
      requirements(understanding = {}) {
        return requirementsFor({ objective: definition.id, understanding });
      },
      analyze({ understanding = {}, unknowns = [], answers = {} }) {
        return analyzeDiscovery({ objective: definition.id, understanding, unknowns, answers });
      }
    }),
    strategy: Object.freeze({
      build({ understanding = {}, answers = {}, confirmedUnderstanding = {} }) {
        return buildStrategy({ objective: definition.id, understanding, answers, confirmedUnderstanding });
      },
      buildWithAI(options = {}) {
        return buildStrategyWithAI({ ...options, objective: definition.id });
      }
    }),
    buildPlan({ confirmedUnderstanding, strategyResult, answers = {} }) {
      return assertPlanContracts(buildPlan({
        objective: definition.id, confirmedUnderstanding, strategyResult, answers
      }));
    },
    production: Object.freeze({
      contract(deliverableId) {
        return getProductionContract(deliverableId);
      },
      artifactPolicy(deliverableId) {
        return getProductionArtifactPolicy(deliverableId);
      }
    }),
    generation: Object.freeze({
      generate(options) {
        return generateDeliverable(options);
      }
    }),
    validation: Object.freeze({
      validate(output, contract) {
        return validateCustomerReadyOutput(output, contract);
      }
    }),
    presentation: Object.freeze({
      sections(output, contract) {
        const quality = validateCustomerReadyOutput(output, contract);
        return quality.valid ? contract.presentationSections(output) : [];
      }
    }),
    persistence: definition.journey.persistence,
    acceptance: definition.journey.acceptance
  });
}

module.exports = { assertPlanContracts, createObjectiveRuntime };
