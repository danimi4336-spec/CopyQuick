const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine, MAX_SUPPORTED_SCHEMA_VERSION } = require('../db/migrations');
const {
  activeMemory, brandBrainProjection, memoryUnderstanding, mergeCurrentWithMemory,
  productionMemoryContext, promoteObjectiveMemory, reconcileMemory, resetMemory,
  syncBrandBrainMemory, backfillLegacyBrandBrain
} = require('../lib/businessMemory');
const { explicitCurrentInput } = require('../lib/businessMemory');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrationEngine(db, { logger() {} });
assert.strictEqual(MAX_SUPPORTED_SCHEMA_VERSION, 8);
assert(db.prepare("SELECT 1 FROM sqlite_master WHERE name='business_memory_subjects'").get());
assert(db.prepare("SELECT 1 FROM sqlite_master WHERE name='business_memory_records'").get());

const legacyDb = new Database(':memory:');
runMigrationEngine(legacyDb, { registry: require('../db/migrations').MIGRATIONS.slice(0, 7), minVersion: 1, maxVersion: 7, logger() {} });
const legacyUser = Number(legacyDb.prepare("INSERT INTO users(email,name) VALUES('legacy-memory@example.com','Legacy')").run().lastInsertRowid);
legacyDb.prepare("INSERT INTO brand_brain(user_id,business_name,industry,target_audience) VALUES(?,?,?,?)").run(legacyUser, 'Legacy Co', 'Accounting', 'Small businesses');
runMigrationEngine(legacyDb, { logger() {} });
backfillLegacyBrandBrain(legacyDb, { userId: legacyUser });
const legacyFacts = activeMemory(legacyDb, { userId: legacyUser });
assert(legacyFacts.some(row => row.concept === 'brand_name' && row.label === 'Legacy Co' && row.source_reference_type === 'legacy_brand_brain'));
assert(!legacyFacts.some(row => row.concept === 'target_audience'), 'legacy audience is not promoted globally without an offer scope');
legacyDb.close();
const userA = Number(db.prepare("INSERT INTO users(email,name) VALUES('memory-a@example.com','A')").run().lastInsertRowid);
const userB = Number(db.prepare("INSERT INTO users(email,name) VALUES('memory-b@example.com','B')").run().lastInsertRowid);

const confirmed = (value, extra = {}) => ({ value, label: Array.isArray(value) ? value.join(', ') : value, source: 'user_confirmed', confidence: 1, ...extra });
const inferred = (value, confidence = .95) => ({ value, label: value, source: 'inferred', confidence });
const unresolved = { value: 'unsure', label: "I'm not sure yet", source: 'user_confirmed', confidence: 1 };
const base = {
  businessType: confirmed('Service business'), industry: confirmed('Residential remodeling'),
  serviceMarket: confirmed('Virginia'), serviceDefinition: confirmed('Kitchen, bathroom, and whole-home renovations'),
  currentAcquisitionChannel: confirmed('Referrals'), customerMotivation: unresolved,
  recommendedChannel: confirmed('Google Ads', { semanticRole: 'strategic_recommendation' }),
  conceptMaturity: inferred('Idea only', .8),
  productExploration: confirmed(['Gut microbiome support'], { semanticRole: 'exploration_intent' })
};
const promoted = promoteObjectiveMemory(db, { userId: userA, objective: 'get_more_customers', understanding: base, answers: { initial_description: 'Residential remodeling company in Virginia. We specialize in kitchens, bathrooms, and whole-home renovations.' }, referenceId: 'plan-a' });
assert(promoted.subjects.business.id && promoted.subjects.offer.id);
const facts = activeMemory(db, { userId: userA, includePending: true });
assert(facts.some(row => row.concept === 'business_type' && row.provenance === 'confirmed_fact'));
assert(facts.some(row => row.concept === 'geography'));
assert(facts.some(row => row.concept === 'current_channel'));
assert(facts.some(row => row.concept === 'industry' && row.label === 'Residential remodeling'));
assert(facts.some(row => row.concept === 'confirmed_offer_fact' && /kitchens/i.test(row.label)));
assert(!facts.some(row => row.label.includes("not sure")), 'unresolved input must never promote');
assert(!facts.some(row => row.concept === 'recommended_channel'), 'recommendations are outside the promotion allowlist');
assert(!facts.some(row => row.label.includes('microbiome')), 'exploration intent must never promote');
assert(!facts.some(row => row.concept === 'product_maturity'), 'low-confidence inference must not promote');

const remembered = memoryUnderstanding(db, { userId: userA, objective: 'increase_conversion_rates', initialDescription: 'Our residential remodeling company wants to improve conversions.' });
assert.strictEqual(remembered.understanding.businessType.source, 'remembered_confirmed');
assert.strictEqual(remembered.understanding.serviceMarket.label, 'Virginia');
assert.strictEqual(remembered.understanding.currentAcquisitionChannel.label, 'Referrals');
assert.match(remembered.understanding.currentOffer.label, /kitchen/i, 'compatible offer facts are reused');
const merged = mergeCurrentWithMemory({ businessType: confirmed('Consultancy') }, remembered);
assert.strictEqual(merged.understanding.businessType.label, 'Consultancy', 'current explicit input governs the current objective');
assert(merged.conflicts.some(item => item.field === 'businessType'));
const explicitChannel = explicitCurrentInput('get_more_customers', 'We now get most leads from Google Ads.');
const channelConflict = mergeCurrentWithMemory(explicitChannel, remembered);
assert.strictEqual(channelConflict.understanding.currentAcquisitionChannel.label, 'Google Ads');
assert(channelConflict.conflicts.some(item => item.field === 'currentAcquisitionChannel'), 'explicit current input conflicts with remembered state instead of being overwritten');

const channel = facts.find(row => row.concept === 'current_channel');
assert(channel);
assert.strictEqual(reconcileMemory(db, { userId: userB, recordId: channel.id, action: 'remove' }).valid, false, 'IDs alone never authorize memory access');
const replacement = reconcileMemory(db, { userId: userA, recordId: channel.id, action: 'replace', value: 'Google Ads', label: 'Google Ads' });
assert(replacement.valid);
assert.strictEqual(db.prepare('SELECT status FROM business_memory_records WHERE id=?').get(channel.id).status, 'superseded');
assert(activeMemory(db, { userId: userA }).some(row => row.concept === 'current_channel' && row.label === 'Google Ads'));

syncBrandBrainMemory(db, { userId: userA, values: { business_name: 'Renovation Co', industry: 'Home improvement', target_audience: 'Homeowners', brand_voice: 'friendly' } });
const projection = brandBrainProjection(db, { userId: userA });
assert(projection.current.some(row => row.concept === 'brand_name'));
assert(projection.history.some(row => row.status === 'superseded'));
assert(projection.confirmedCoverage > 0 && projection.confirmedCoverage <= 100);
assert.deepStrictEqual(activeMemory(db, { userId: userB }), [], 'tenant memory is isolated');
assert.deepStrictEqual(productionMemoryContext(db, { userId: userB }), [], 'tenant memory cannot enter Production');
assert(productionMemoryContext(db, { userId: userA }).every(item => !('id' in item) && !('source_reference_id' in item)), 'provider context is bounded and omits internal IDs');

const offerA = promoteObjectiveMemory(db, { userId: userA, objective: 'launch_product', understanding: { category: confirmed('Digestive supplement'), targetAudience: confirmed('Adults') }, answers: { initial_description: 'Digestive supplement A' }, referenceId: 'offer-a' });
promoteObjectiveMemory(db, { userId: userA, objective: 'launch_product', understanding: { category: confirmed('Ceylon cinnamon supplement'), targetAudience: confirmed('Adults with glucose concerns') }, answers: { initial_description: 'Ceylon Cinnamon Supplement B' }, referenceId: 'offer-b' });
const offerARecords = activeMemory(db, { userId: userA, subjectId: offerA.subjects.offer.id });
assert(offerARecords.some(row => row.label === 'Digestive supplement'));
assert(!offerARecords.some(row => row.label.includes('Ceylon')), 'offer-scoped facts cannot cross offers');

const beforeReset = db.prepare("SELECT COUNT(*) count FROM business_memory_records WHERE user_id=? AND status='active'").get(userA).count;
assert(beforeReset > 0);
assert(resetMemory(db, { userId: userB }) === 0);
assert(db.prepare("SELECT COUNT(*) count FROM business_memory_records WHERE user_id=? AND status='active'").get(userA).count > 0, 'another user cannot reset memory');

console.log('Story 3.234 persistent business memory tests passed');
