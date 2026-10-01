const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getProductionContract } = require('../lib/productionContracts');
const { customerPurpose, isCustomerReadablePlanningDocument } = require('../lib/productionArtifactPolicy');
const { validateCustomerReadyOutput } = require('../lib/productionQuality');

const context = {
  objective: 'increase_conversion_rates',
  title: 'Conversion planning',
  strategicDirection: 'Help qualified homeowners book a remodeling consultation.',
  strategySnapshot: {
    conversionMode: 'SERVICE_CONSULTATION',
    confirmedUnderstanding: {
      currentOffer: { value: 'Residential remodeling consultations', label: 'Residential remodeling consultations', source: 'user_confirmed', confidence: 1 },
      targetAudience: { value: 'Homeowners planning major renovations', label: 'Homeowners planning major renovations', source: 'user_confirmed', confidence: 1 },
      funnelType: { value: 'booked_call', label: 'Book a consultation', source: 'user_confirmed', confidence: 1 },
      primaryCta: { value: 'Book a consultation', label: 'Book a consultation', source: 'user_confirmed', confidence: 1 }
    }
  },
  dependencyOutputs: []
};

const affected = [
  'conversion_diagnostic_brief',
  'consultation_conversion_brief',
  'conversion_measurement_plan'
];

for (const id of affected) {
  const contract = getProductionContract(id);
  const output = contract.generateOutput({ ...context, title: contract.title });
  const sections = contract.presentationSections(output);
  assert.strictEqual(isCustomerReadablePlanningDocument(id), true);
  assert(sections.length > 0);
  assert(sections.every(section => section.internal === false), `${id} customer planning content must be public`);
  assert.deepStrictEqual(contract.internalFieldKeys, []);
  assert.deepStrictEqual(contract.publicFieldKeys, Object.keys(contract.outputSchema));
  assert.match(customerPurpose(id), /conversion|consultation|measure/i);
  assert.match(contract.buildPrompt({ ...context, title: contract.title }), /customer-readable planning content/i);
  assert.strictEqual(validateCustomerReadyOutput(output, contract, context).valid, true);

  const copyAllText = sections.filter(section => !section.internal).map(section => Array.isArray(section.value) ? section.value.join('\n') : section.value).join('\n\n---\n\n');
  const txt = sections.filter(section => !section.internal).map(section => `${section.label}\n${section.isList ? section.value.map(item => `- ${item}`).join('\n') : section.value}`).join('\n\n');
  const markdown = `# ${contract.title}\n\n` + sections.filter(section => !section.internal).map(section => `## ${section.label}\n\n${section.isList ? section.value.map(item => `- ${item}`).join('\n') : section.value}`).join('\n\n');
  assert.match(copyAllText, new RegExp(String(output.summary).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(txt, /Overview/);
  assert.match(markdown, /^# .+\n\n## Overview/m);
  assert.doesNotMatch(`${copyAllText}\n${txt}\n${markdown}`, /provider note|validator detail|contract metadata|runtime metadata/i);

  // Historical structured results are rendered through current presentation metadata without mutation.
  const historical = JSON.parse(JSON.stringify(output));
  contract.presentationSections(historical);
  assert.deepStrictEqual(historical, output);
}

const pageCopy = getProductionContract('consultation_conversion_page_copy');
const pageOutput = pageCopy.generateOutput({ ...context, title: pageCopy.title });
assert(pageCopy.presentationSections(pageOutput).some(section => section.key === 'editorialReviewNotes' && section.internal));
assert(pageCopy.presentationSections(pageOutput).some(section => section.key === 'heroHeadline' && !section.internal));

const researchPack = getProductionContract('research_evidence_pack');
assert(researchPack.internalFieldKeys.includes('researchTrace'));
assert.strictEqual(isCustomerReadablePlanningDocument('research_evidence_pack'), false);

const detailTemplate = fs.readFileSync(path.join(__dirname, '..', 'views', 'generation.ejs'), 'utf8');
assert.match(detailTemplate, /if \(internalSections\.length\)/, 'empty Editorial review disclosures remain suppressed');
assert.match(detailTemplate, /sections\.filter\(function\(section\) \{ return !section\.internal; \}\)/);
const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
assert.match(routes, /presentationSections\(output\)\.filter\(section => !section\.internal\)/, 'TXT and Markdown export only public sections');
assert.match(routes, /customer-readable planning document/);

assert.strictEqual(getProductionContract('consultation_conversion_brief').version, 'consultation_conversion_brief:v1');
assert.strictEqual(getProductionContract('conversion_diagnostic_brief').version, 'conversion_diagnostic_brief:v3');
assert.strictEqual(getProductionContract('conversion_measurement_plan').version, 'conversion_measurement_plan:v3');

console.log('Story 3.247 customer-readable planning documents tests passed');
