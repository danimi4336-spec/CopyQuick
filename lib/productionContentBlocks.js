const { buildEvidenceLedger } = require('./productionEvidence');
const {
  claimMatchesEvidence,
  isConditionalGuidance,
  isGeneralGuidance,
  publicClaimUnits
} = require('./productionClaims');

const BLOCK_ROLES = Object.freeze(['confirmed_fact', 'conditional_guidance', 'general_guidance']);
const ARTICLE_BLOCK_SCHEMA = Object.freeze({
  type: 'array',
  minItems: 6,
  items: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1 },
      heading: { type: 'string', minLength: 1 },
      copy: { type: 'string', minLength: 80 },
      supportType: { type: 'string', enum: BLOCK_ROLES },
      sourceIds: { type: 'array', items: { type: 'string' } }
    },
    required: ['id', 'heading', 'copy', 'supportType', 'sourceIds'],
    additionalProperties: false
  }
});

const ARTICLE_BLOCK_REPAIR_SCHEMA = Object.freeze({
  ...ARTICLE_BLOCK_SCHEMA,
  minItems: 1
});

function organicProviderSchema(baseSchema) {
  const schema = { ...baseSchema };
  delete schema.introduction;
  delete schema.claimSupport;
  schema.articleBlocks = ARTICLE_BLOCK_SCHEMA;
  return Object.freeze(schema);
}

function evidenceLedger(context) {
  return context?.evidenceLedger || buildEvidenceLedger({
    strategySnapshot: context?.strategySnapshot,
    brandContext: context?.brandContext,
    dependencyOutputs: context?.dependencyOutputs
  });
}

function validateBlock(block, context) {
  const failures = [];
  if (!block || typeof block !== 'object' || !String(block.id || '').trim()) failures.push('missing block id');
  if (!String(block?.heading || '').trim()) failures.push('missing heading');
  if (!String(block?.copy || '').trim()) failures.push('missing copy');
  if (!BLOCK_ROLES.includes(block?.supportType)) failures.push('unknown support type');
  // Headings organize the article; they are not standalone factual sentences.
  // Validate the developed copy sentence by sentence so a useful block may
  // combine confirmed context with safely qualified guidance.
  const output = { introduction: String(block?.copy || '') };
  const units = publicClaimUnits(output, { publicFieldKeys: ['introduction'] });
  const publicEvidence = new Map(evidenceLedger(context)
    .filter(entry => entry.permittedUse === 'public_claim')
    .map(entry => [entry.id, entry]));
  const mappings = [];
  for (const unit of units) {
    let sourceId = null;
    // Prefer the block's declared support, but resolve each sentence against
    // every safe category. Requiring one role for an entire developed section
    // made ordinary transitions and practical guidance impossible to express.
    if (block?.supportType === 'confirmed_fact') sourceId = (block.sourceIds || []).find(id => publicEvidence.has(id)
      && claimMatchesEvidence(unit.text, publicEvidence.get(id))) || null;
    if (!sourceId && block?.supportType === 'conditional_guidance' && isConditionalGuidance(unit.text)) sourceId = 'conditional_guidance';
    if (!sourceId && block?.supportType === 'general_guidance' && isGeneralGuidance(unit.text)) sourceId = 'general_guidance';
    if (!sourceId) sourceId = (block?.sourceIds || []).find(id => publicEvidence.has(id)
      && claimMatchesEvidence(unit.text, publicEvidence.get(id))) || null;
    if (!sourceId && isConditionalGuidance(unit.text)) sourceId = 'conditional_guidance';
    if (!sourceId && isGeneralGuidance(unit.text)) sourceId = 'general_guidance';
    if (!sourceId) failures.push(`unsupported sentence in ${String(block?.id || 'unknown')}`);
    else mappings.push(`${sourceId} :: ${unit.text}`);
  }
  return Object.freeze({ valid: failures.length === 0, failures: Object.freeze(failures), mappings: Object.freeze(mappings) });
}

function compileOrganicBlocks(providerOutput, context) {
  const blocks = Array.isArray(providerOutput?.articleBlocks) ? providerOutput.articleBlocks : [];
  const ids = new Set();
  const invalidBlocks = [];
  const claimSupport = [];
  for (const block of blocks) {
    const id = String(block?.id || '').trim();
    const result = validateBlock(block, context);
    if (!id || ids.has(id) || !result.valid) invalidBlocks.push({ id: id || 'unknown', failures: result.failures });
    else {
      ids.add(id);
      claimSupport.push(...result.mappings);
    }
  }
  for (let index = blocks.length; index < 6; index += 1) {
    invalidBlocks.push({ id: `missing-block-${index + 1}`, failures: Object.freeze(['missing required article block']) });
  }
  if (invalidBlocks.length || blocks.length < 6) {
    const error = new Error('Generated article blocks did not meet evidence requirements');
    error.code = 'PRODUCTION_BLOCK_PROVENANCE_FAILED';
    error.details = Object.freeze({
      invalidBlocks: Object.freeze(invalidBlocks),
      validBlockIds: Object.freeze([...ids]),
      requiredBlockCount: 6,
      actualBlockCount: blocks.length
    });
    error.validationDiagnostics = Object.freeze({
      invalidBlockIds: Object.freeze(invalidBlocks.map(block => block.id)),
      requiredBlockCount: 6,
      actualBlockCount: blocks.length
    });
    throw error;
  }
  const introduction = blocks.map(block => {
    const heading = String(block.heading).replace(/^#{1,6}\s+/, '').trim();
    return `## ${heading}\n\n${String(block.copy).trim()}`;
  }).join('\n\n');
  const { articleBlocks, ...output } = providerOutput;
  const compiled = { ...output, introduction, claimSupport };
  // Title, CTA, and distribution posts are outside article blocks and are
  // reconciled deterministically against the same evidence ledger.
  return compiled;
}

function blockPromptInstruction() {
  return [
    'Evidence-first article blocks: return articleBlocks instead of a monolithic introduction.',
    'Each block must have a stable short id, a concise heading, developed copy, one supportType, and sourceIds.',
    'Set supportType to the primary support used by the block. Every factual sentence must match one of the block’s confirmed-fact ledger sourceIds.',
    'Questions, imperatives, and genuinely conditional statements may be used as conditional guidance within a block.',
    'Non-local, non-regulated explanations that make no audience, business, offer, or outcome claim may be used as general guidance within a block.',
    'A block may combine these safe sentence types, but must not contain any unsupported unconditional assertion.',
    'Return at least six developed blocks. The backend will assemble their headings and copy into the final article.'
  ].join(' ');
}

module.exports = {
  ARTICLE_BLOCK_SCHEMA,
  ARTICLE_BLOCK_REPAIR_SCHEMA,
  BLOCK_ROLES,
  blockPromptInstruction,
  compileOrganicBlocks,
  organicProviderSchema,
  validateBlock
};
