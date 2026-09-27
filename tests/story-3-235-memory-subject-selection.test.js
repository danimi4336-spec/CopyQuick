const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const {
  activeMemory, brandBrainProjection, listOfferSubjects, memoryUnderstanding,
  promoteObjectiveMemory, reconcileMemory, resolveObjectiveSubjects
} = require('../lib/businessMemory');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { buildObjectiveInsights } = require('../lib/objectiveInsights');

const confirmed = (value, label = value) => ({ value, label, source: 'user_confirmed', confidence: 1 });
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrationEngine(db, { logger() {} });
const userA = Number(db.prepare("INSERT INTO users(email,name) VALUES('story235-a@example.com','A')").run().lastInsertRowid);
const userB = Number(db.prepare("INSERT INTO users(email,name) VALUES('story235-b@example.com','B')").run().lastInsertRowid);

let resolution = resolveObjectiveSubjects(db, { userId: userA, initialDescription: 'Improve booked consultations.' });
assert.strictEqual(resolution.offers.length, 0, 'zero offers continues without selection');
assert.strictEqual(resolution.requiresSelection, undefined);

const remodel = promoteObjectiveMemory(db, {
  userId: userA, objective: 'get_more_customers', referenceId: 'remodel-plan',
  answers: { initial_description: 'Residential remodeling company in Virginia. We specialize in kitchens, bathrooms, and whole-home renovations.' },
  understanding: {
    businessType: confirmed('service', 'A service'), industry: confirmed('Residential remodeling'),
    serviceMarket: confirmed('Virginia'), serviceDefinition: confirmed('Kitchen, bathroom, and whole-home renovations'),
    targetAudience: confirmed('Homeowners planning renovations'), currentAcquisitionChannel: confirmed('Referrals')
  }
});
assert(remodel.subjects.offer.id);

resolution = resolveObjectiveSubjects(db, { userId: userA, initialDescription: 'I want more website visitors to book consultations.' });
assert.strictEqual(resolution.selection, 'automatic');
assert.strictEqual(resolution.offer.id, remodel.subjects.offer.id, 'one remembered offer auto-binds without repeated identity');
const remembered = memoryUnderstanding(db, { userId: userA, objective: 'increase_conversion_rates', initialDescription: 'Improve bookings.', subjectId: resolution.offer.id });
assert.match(remembered.understanding.currentOffer.label, /kitchen/i);
assert.match(remembered.understanding.targetAudience.label, /homeowners/i);

const offerB = promoteObjectiveMemory(db, {
  userId: userA, objective: 'launch_product', referenceId: 'cinnamon-plan',
  answers: { initial_description: 'Ceylon Cinnamon Supplement B' },
  understanding: { category: confirmed('Ceylon cinnamon supplement'), targetAudience: confirmed('Adults with glucose concerns') }
});
resolution = resolveObjectiveSubjects(db, { userId: userA, initialDescription: 'Improve our conversion path.' });
assert.strictEqual(resolution.requiresSelection, true, 'multiple plausible offers require selection');
assert.strictEqual(resolveObjectiveSubjects(db, { userId: userA, initialDescription: '', selectedOfferId: offerB.subjects.offer.id }).offer.id, offerB.subjects.offer.id);
assert.strictEqual(resolveObjectiveSubjects(db, { userId: userB, initialDescription: '', selectedOfferId: offerB.subjects.offer.id }).invalid, true, 'subject IDs are owner scoped');
assert.strictEqual(resolveObjectiveSubjects(db, { userId: userA, initialDescription: '', newOffer: true }).selection, 'new');
assert(listOfferSubjects(db, { userId: userA }).every(item => !('user_id' in item)), 'picker does not expose owner data');

const priorAudience = activeMemory(db, { userId: userA, subjectId: remodel.subjects.offer.id }).find(row => row.concept === 'target_audience');
assert(priorAudience);
promoteObjectiveMemory(db, {
  userId: userA, objective: 'get_more_customers', referenceId: 'corrected-plan', subjectIds: { offer: remodel.subjects.offer.id },
  correctionFields: ['targetAudience'], answers: { initial_description: 'Residential remodeling company' },
  understanding: { targetAudience: confirmed('Homeowners planning major renovations') }
});
const audiences = activeMemory(db, { userId: userA, subjectId: remodel.subjects.offer.id }).filter(row => row.concept === 'target_audience');
assert.deepStrictEqual(audiences.map(row => row.label), ['Homeowners planning major renovations']);
assert.strictEqual(db.prepare('SELECT status FROM business_memory_records WHERE id=?').get(priorAudience.id).status, 'superseded');
assert(brandBrainProjection(db, { userId: userA }).history.some(row => row.id === priorAudience.id));
assert.strictEqual(memoryUnderstanding(db, { userId: userA, objective: 'increase_conversion_rates', subjectId: remodel.subjects.offer.id }).understanding.targetAudience.label, 'Homeowners planning major renovations');

const channel = activeMemory(db, { userId: userA, subjectId: remodel.subjects.offer.id }).find(row => row.concept === 'current_channel');
assert.strictEqual(reconcileMemory(db, { userId: userA, recordId: channel.id, action: 'add', value: 'Google Ads', label: 'Google Ads' }).outcome, 'addition');
assert(activeMemory(db, { userId: userA, subjectId: remodel.subjects.offer.id }).filter(row => row.concept === 'current_channel').length === 2);
const beforeObjectiveOnly = activeMemory(db, { userId: userA, subjectId: remodel.subjects.offer.id }).length;
assert.strictEqual(reconcileMemory(db, { userId: userA, recordId: channel.id, action: 'objective_only', value: 'Organic search' }).outcome, 'objective_only');
assert.strictEqual(activeMemory(db, { userId: userA, subjectId: remodel.subjects.offer.id }).length, beforeObjectiveOnly);

const offerARecords = activeMemory(db, { userId: userA, subjectId: remodel.subjects.offer.id });
assert(!offerARecords.some(row => /Ceylon/i.test(row.label)), 'offer facts stay isolated');

(async () => {
  const falseAudience = await understandBusiness({ objective: 'get_more_customers', answer: 'For our residential remodeling company, we now use Google Ads.' });
  assert(!falseAudience.understanding.targetAudience, 'business-subject phrase is not an audience');
  const realAudience = await understandBusiness({ objective: 'get_more_customers', answer: 'A remodeling service for homeowners planning major renovations.' });
  assert.match(realAudience.understanding.targetAudience.label, /homeowners/i);

  const consultation = buildObjectiveInsights({ objective: 'increase_conversion_rates', understanding: { funnelType: confirmed('booked_call', 'Book a call or appointment') } });
  assert.strictEqual(consultation.businessObjective.value, 'Improve booked-consultation conversion');
  assert.doesNotMatch(consultation.businessObjective.value, /purchase/i);
  const purchase = buildObjectiveInsights({ objective: 'increase_conversion_rates', understanding: { funnelType: confirmed('purchase', 'Purchase online') } });
  assert.strictEqual(purchase.businessObjective.value, 'Improve purchase conversion');
  const trial = buildObjectiveInsights({ objective: 'increase_conversion_rates', understanding: { funnelType: confirmed('trial_signup', 'Start a trial or account') } });
  assert.match(trial.businessObjective.value, /trial/i);
  const unknown = buildObjectiveInsights({ objective: 'increase_conversion_rates', understanding: { funnelType: confirmed('unsure', "I'm not sure yet") } });
  assert.match(unknown.businessObjective.value, /established conversion path/i);

  console.log('Story 3.235 memory subject selection tests passed');
  db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
