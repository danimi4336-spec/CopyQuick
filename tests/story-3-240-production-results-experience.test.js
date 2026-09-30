const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { customerPurpose, customerReadiness, customerStatusLabel } = require('../lib/productionArtifactPolicy');
const { generateResearchEvidencePack } = require('../lib/productionResearchEvidence');

assert.strictEqual(customerReadiness({ deliverableId: 'priority_search_article', status: 'completed', valid: true }), 'READY_FOR_REVIEW');
assert.strictEqual(customerStatusLabel('READY_FOR_REVIEW', 'completed'), 'Ready for review');
assert.strictEqual(customerReadiness({ deliverableId: 'search_strategy', status: 'completed', valid: true }), 'AVAILABLE');
assert.strictEqual(customerReadiness({ deliverableId: 'priority_search_article', status: 'recovery_required' }), 'NEEDS_SAFE_REVIEW');
assert.strictEqual(customerStatusLabel('CREATING', 'waiting_dependency'), 'Waiting for earlier work');
assert.match(customerPurpose('research_evidence_pack'), /Sources and evidence/);

(async () => {
  const prohibited = await generateResearchEvidencePack({ dependencyOutputs: [{ deliverableId: 'priority_content_brief', output: { specificTopic: 'supplement dosage', readerQuestion: 'What dosage cures diabetes?', evidenceLimits: [] } }] });
  assert.notStrictEqual(prohibited.researchStatus, 'No research needed');
  assert.strictEqual(prohibited.noExternalEvidenceRequired, false);
  assert(prohibited.questionsNeedingEvidence > 0);

  const studio = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-studio.ejs'), 'utf8');
  assert.match(studio, /Ready for review/); assert.match(studio, /Research &amp; Sources/); assert.match(studio, /Strategy &amp; Planning/);
  assert.doesNotMatch(studio, /real persisted queue state|internal prerequisites/);
  const detail = fs.readFileSync(path.join(__dirname, '..', 'views', 'generation.ejs'), 'utf8');
  assert.match(detail, /Back to results/); assert.match(detail, /Improve this asset with AI/); assert.match(detail, /displayed version will be replaced/);
  assert.doesNotMatch(detail, /<span class="meta-label">(?:Output Source|Model|Generation Method)/);
  assert.match(detail, /aria-label="Copy <%= section.label %>"/); assert.match(detail, /Asset copied to clipboard/);
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'generations.js'), 'utf8');
  assert.match(routes, /safeExportSlug/); assert.doesNotMatch(routes, /copyquick-deliverable-\$\{gen\.id\}/);
  assert.match(routes, /Research limited/);
  assert.match(routes, /No external sources were used; one or more requested claims remain outside the available evidence boundary/);
  assert.match(routes, /section\.value !== null && section\.value !== undefined/);
  console.log('Story 3.240 Production Results Experience tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
