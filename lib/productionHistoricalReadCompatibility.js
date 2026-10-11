const { getProductionContract } = require('./productionContracts');
const { validateCustomerReadyOutput } = require('./productionQuality');
const { loadProductionValidationContext } = require('./productionValidationContext');
const { parseDependencies } = require('./productionState');

const HISTORICAL_V1_DEFINITIONS = Object.freeze({
  customer_profile: Object.freeze({
    title: 'Customer Profile',
    contentType: 'sales_message', artifactRole: 'planning_foundation', billingUnits: 0,
    schema: Object.freeze({
      summary: 'string', primaryCustomer: 'string', needs: 'array', motivations: 'array',
      objections: 'array', buyingTriggers: 'array', languageStyle: 'string'
    }),
    labels: Object.freeze({
      summary: 'Profile Summary', primaryCustomer: 'Primary Customer', needs: 'Needs',
      motivations: 'Motivations', objections: 'Objections', buyingTriggers: 'Buying Triggers',
      languageStyle: 'Language & Communication Style'
    }),
    dependencies: Object.freeze([])
  }),
  product_positioning: Object.freeze({
    title: 'Product Positioning',
    contentType: 'sales_message', artifactRole: 'planning_foundation', billingUnits: 0,
    schema: Object.freeze({
      positioningStatement: 'string', marketPosition: 'string', differentiation: 'string',
      proofPoints: 'array', positioningPillars: 'array', messagingImplications: 'array'
    }),
    labels: Object.freeze({
      positioningStatement: 'Positioning Statement', marketPosition: 'Market Position',
      differentiation: 'Core Differentiation', proofPoints: 'Evidence to Establish',
      positioningPillars: 'Positioning Pillars', messagingImplications: 'Messaging Implications'
    }),
    dependencies: Object.freeze(['customer_profile'])
  }),
  value_proposition: Object.freeze({
    title: 'Value Proposition',
    contentType: 'sales_message', artifactRole: 'planning_foundation', billingUnits: 0,
    schema: Object.freeze({
      primaryValueProposition: 'string', customerProblemOrDesire: 'string', promisedOutcome: 'string',
      reasonsToBelieve: 'array', differentiators: 'array', supportingMessages: 'array'
    }),
    labels: Object.freeze({
      primaryValueProposition: 'Primary Value Proposition', customerProblemOrDesire: 'Customer Problem or Desire',
      promisedOutcome: 'Promised Outcome', reasonsToBelieve: 'Evidence to Establish',
      differentiators: 'Differentiators', supportingMessages: 'Supporting Messages'
    }),
    dependencies: Object.freeze(['customer_profile', 'product_positioning'])
  }),
  core_messaging: Object.freeze({
    title: 'Core Messaging',
    contentType: 'sales_message', artifactRole: 'planning_foundation', billingUnits: 0,
    schema: Object.freeze({
      coreMessage: 'string', messagePillars: 'array', supportingPoints: 'array',
      toneGuidance: 'string', proofThemes: 'array', callsToAction: 'array'
    }),
    labels: Object.freeze({
      coreMessage: 'Core Message', messagePillars: 'Message Pillars', supportingPoints: 'Supporting Points',
      toneGuidance: 'Tone Guidance', proofThemes: 'Proof Themes', callsToAction: 'Calls to Action'
    }),
    dependencies: Object.freeze(['customer_profile', 'product_positioning', 'value_proposition'])
  }),
  product_image_guidance: Object.freeze({
    title: 'Product Image Guidance',
    contentType: 'sales_message', artifactRole: 'planning_foundation', billingUnits: 0,
    schema: Object.freeze({ summary: 'string', content: 'array' }),
    labels: Object.freeze({ summary: 'Overview', content: 'Image Guidance' }),
    dependencies: Object.freeze(['product_positioning'])
  }),
  launch_announcement: Object.freeze({
    title: 'Launch Announcement',
    contentType: 'email_campaign', artifactRole: 'ready_to_use_asset', billingUnits: 1,
    schema: Object.freeze({ summary: 'string', content: 'array' }),
    labels: Object.freeze({ summary: 'Overview', content: 'Launch Announcement' }),
    dependencies: Object.freeze(['core_messaging'])
  }),
  educational_content: Object.freeze({
    title: 'Educational Launch Content',
    contentType: 'blog_intro', artifactRole: 'ready_to_use_asset', billingUnits: 1,
    schema: Object.freeze({ summary: 'string', content: 'array' }),
    labels: Object.freeze({ summary: 'Overview', content: 'Educational Content' }),
    dependencies: Object.freeze(['core_messaging'])
  }),
  social_launch_campaign: Object.freeze({
    title: 'Social Launch Campaign',
    contentType: 'social_post', artifactRole: 'ready_to_use_asset', billingUnits: 1,
    schema: Object.freeze({ summary: 'string', content: 'array' }),
    labels: Object.freeze({ summary: 'Overview', content: 'Social Launch Campaign' }),
    dependencies: Object.freeze(['core_messaging', 'launch_announcement'])
  })
});

const MAX_HISTORICAL_STRING_LENGTH = 20000;
const MAX_HISTORICAL_ARRAY_LENGTH = 100;
const MAX_HISTORICAL_TOTAL_LENGTH = 100000;
const UNSAFE_HISTORICAL_MARKUP = /<\/?[a-z][^>]*>|\[[^\]]+\]\(\s*(?:javascript|data|file):/i;

function nonEmptyBoundedString(value) {
  return typeof value === 'string' && Boolean(value.trim())
    && value.length <= MAX_HISTORICAL_STRING_LENGTH
    && !UNSAFE_HISTORICAL_MARKUP.test(value);
}

function validatesFrozenSchema(output, schema) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return false;
  const schemaKeys = Object.keys(schema);
  const outputKeys = Object.keys(output);
  if (outputKeys.length !== schemaKeys.length || outputKeys.some(key => !Object.hasOwn(schema, key))) return false;
  let totalLength = 0;
  for (const [key, type] of Object.entries(schema)) {
    if (type === 'string') {
      if (!nonEmptyBoundedString(output[key])) return false;
      totalLength += output[key].length;
      continue;
    }
    if (!Array.isArray(output[key]) || !output[key].length || output[key].length > MAX_HISTORICAL_ARRAY_LENGTH
      || !output[key].every(nonEmptyBoundedString)) return false;
    totalLength += output[key].reduce((sum, item) => sum + item.length, 0);
  }
  return totalLength <= MAX_HISTORICAL_TOTAL_LENGTH;
}

function presentationSections(definition, output) {
  return Object.keys(definition.schema).map(key => Object.freeze({
    key,
    label: definition.labels[key],
    value: output[key],
    isList: Array.isArray(output[key]),
    role: 'public_copy',
    internal: false,
    format: 'plain_text',
    guidanceLabel: null
  }));
}

function makeHistoricalReadContract(deliverableId, definition) {
  const publicFieldKeys = Object.freeze(Object.keys(definition.schema));
  return Object.freeze({
    id: `historical_v1_${deliverableId}`,
    deliverableId,
    title: definition.title,
    version: `${deliverableId}:v1`,
    contentType: definition.contentType,
    displayType: `${definition.title} — Historical`,
    historicalReadOnly: true,
    artifactRole: definition.artifactRole,
    billingUnits: definition.billingUnits,
    readyToUse: true,
    validationProfile: Object.freeze({
      policy: 'historical_read_quality_v1',
      family: 'historical_read',
      allowedPlaceholders: Object.freeze([])
    }),
    outputSchema: definition.schema,
    publicFieldKeys,
    internalFieldKeys: Object.freeze([]),
    ctaFieldKeys: Object.freeze([]),
    requiredDependencies: definition.dependencies,
    acceptsVersion(candidate) { return candidate === `${deliverableId}:v1`; },
    validateOutput(output) { return validatesFrozenSchema(output, definition.schema); },
    presentationSections(output) { return presentationSections(definition, output); }
  });
}

const HISTORICAL_V1_CONTRACTS = Object.freeze(Object.fromEntries(
  Object.entries(HISTORICAL_V1_DEFINITIONS).map(([deliverableId, definition]) => [
    `${deliverableId}:v1`, makeHistoricalReadContract(deliverableId, definition)
  ])
));

function getHistoricalProductionReadContract(deliverableId, contractVersion) {
  const contract = HISTORICAL_V1_CONTRACTS[`${deliverableId}:v1`] || null;
  return contract && contract.version === contractVersion ? contract : null;
}

function sameDependencies(actual, expected) {
  return actual.length === expected.length && expected.every(id => actual.includes(id));
}

function historicalIntegrityFailure(code) {
  return Object.freeze({ valid: false, code });
}

function validateHistoricalDependencyGraph(db, { userId, runId, job, contract, visited }) {
  const visitKey = `${job.id}:${contract.version}`;
  if (visited.has(visitKey)) return historicalIntegrityFailure('HISTORICAL_READ_DEPENDENCIES_INVALID');
  visited.add(visitKey);

  let dependencies;
  try { dependencies = parseDependencies(job.dependencies); } catch (_) {
    return historicalIntegrityFailure('HISTORICAL_READ_DEPENDENCIES_INVALID');
  }
  if (!sameDependencies(dependencies, contract.requiredDependencies)) {
    return historicalIntegrityFailure('HISTORICAL_READ_DEPENDENCIES_INVALID');
  }

  for (const dependencyId of contract.requiredDependencies) {
    const rows = db.prepare(`
      SELECT production_jobs.id, production_jobs.production_run_id, production_jobs.generation_id,
             production_jobs.deliverable_id, production_jobs.contract_version,
             production_jobs.dependencies, production_jobs.status,
             generations.user_id AS generation_user_id,
             generations.production_job_id AS generation_job_id,
             generations.generation_type AS generation_type,
             generations.deliverable_id AS generation_deliverable_id,
             generations.contract_version AS generation_contract_version
      FROM production_jobs
      JOIN generations ON generations.id = production_jobs.generation_id
      WHERE production_jobs.production_run_id = ? AND production_jobs.deliverable_id = ?
        AND production_jobs.status = 'completed'
    `).all(runId, dependencyId);
    if (rows.length !== 1) return historicalIntegrityFailure('HISTORICAL_READ_DEPENDENCY_MISSING');
    const dependency = rows[0];
    const dependencyContract = getHistoricalProductionReadContract(
      dependency.deliverable_id, dependency.contract_version
    );
    if (!dependencyContract || dependency.production_run_id !== runId
      || dependency.generation_user_id !== userId
      || dependency.generation_job_id !== dependency.id
      || dependency.generation_type !== 'production'
      || dependency.generation_deliverable_id !== dependency.deliverable_id
      || dependency.generation_contract_version !== dependency.contract_version) {
      return historicalIntegrityFailure('HISTORICAL_READ_DEPENDENCY_OWNERSHIP_INVALID');
    }
    const nested = validateHistoricalDependencyGraph(db, {
      userId, runId, job: dependency, contract: dependencyContract, visited
    });
    if (!nested.valid) return nested;
    visited.delete(`${dependency.id}:${dependencyContract.version}`);
  }
  return Object.freeze({ valid: true, code: null });
}

function validateHistoricalRecordIntegrity(db, { userId, generation, contract }) {
  if (!generation || generation.user_id !== userId || generation.generation_type !== 'production'
    || generation.deliverable_id !== contract.deliverableId || generation.contract_version !== contract.version
    || !generation.production_job_id) return historicalIntegrityFailure('HISTORICAL_READ_OWNERSHIP_INVALID');

  const job = db.prepare(`
    SELECT id, production_run_id, generation_id, deliverable_id, contract_version, dependencies, status
    FROM production_jobs WHERE id = ? AND generation_id = ?
  `).get(generation.production_job_id, generation.id);
  if (!job || job.status !== 'completed' || job.deliverable_id !== contract.deliverableId
    || job.contract_version !== contract.version) return historicalIntegrityFailure('HISTORICAL_READ_JOB_INVALID');

  const run = db.prepare('SELECT id, user_id FROM production_runs WHERE id = ? AND user_id = ?')
    .get(job.production_run_id, userId);
  if (!run) return historicalIntegrityFailure('HISTORICAL_READ_RUN_OWNERSHIP_INVALID');

  const graph = validateHistoricalDependencyGraph(db, {
    userId, runId: run.id, job, contract, visited: new Set()
  });
  if (!graph.valid) return graph;
  return Object.freeze({ valid: true, code: null, runId: run.id });
}

function resolveProductionReadArtifact(db, { userId, generation, output }) {
  const current = getProductionContract(generation?.deliverable_id);
  if (current?.acceptsVersion(generation?.contract_version)) {
    const validationContext = loadProductionValidationContext(db, { userId, generation });
    const quality = validateCustomerReadyOutput(output, current, validationContext);
    return Object.freeze({
      supported: true, historical: false, contract: current, quality, validationContext,
      sections: quality.valid ? current.presentationSections(output) : Object.freeze([])
    });
  }

  const historical = getHistoricalProductionReadContract(
    generation?.deliverable_id, generation?.contract_version
  );
  if (!historical) {
    return Object.freeze({
      supported: false, historical: false, contract: current,
      quality: historicalIntegrityFailure('HISTORICAL_READ_CONTRACT_UNSUPPORTED'),
      validationContext: null, sections: Object.freeze([])
    });
  }
  const integrity = validateHistoricalRecordIntegrity(db, { userId, generation, contract: historical });
  const quality = integrity.valid
    ? validateCustomerReadyOutput(output, historical, {})
    : integrity;
  return Object.freeze({
    supported: true, historical: true, contract: historical, quality,
    validationContext: null,
    sections: quality.valid ? historical.presentationSections(output) : Object.freeze([]),
    integrity
  });
}

function supportedHistoricalProductionPairs() {
  return Object.freeze(Object.keys(HISTORICAL_V1_CONTRACTS));
}

module.exports = {
  getHistoricalProductionReadContract,
  resolveProductionReadArtifact,
  supportedHistoricalProductionPairs,
  validateHistoricalRecordIntegrity
};
