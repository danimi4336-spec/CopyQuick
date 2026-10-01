const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { audienceFromDescription } = require('../lib/businessUnderstanding');
const {
  activeMemory,
  brandBrainProjection,
  memoryUnderstanding,
  promoteObjectiveMemory,
  reconcileMemory
} = require('../lib/businessMemory');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrationEngine(db, { logger() {} });
const userA = Number(db.prepare("INSERT INTO users(email,name) VALUES('continuity-a@example.com','A')").run().lastInsertRowid);
const userB = Number(db.prepare("INSERT INTO users(email,name) VALUES('continuity-b@example.com','B')").run().lastInsertRowid);
const confirmed = value => ({ value, label: value, source: 'user_confirmed', confidence: 1 });

assert.strictEqual(audienceFromDescription('I want better marketing for this service.', 'promote_service'), '');
assert.strictEqual(audienceFromDescription('I want better marketing for our product.', 'launch_product'), '');

const description = 'I want more website visitors to book a consultation for our residential remodeling business in Virginia. We provide kitchen remodeling, bathroom remodeling, and whole-home renovation for homeowners planning major renovations. Most of our work comes from referrals.';
const first = promoteObjectiveMemory(db, {
  userId: userA,
  objective: 'increase_conversion_rates',
  understanding: {
    businessType: confirmed('Service Business'),
    industry: confirmed('Residential Remodeling'),
    currentOffer: confirmed('Residential remodeling consultation for kitchen, bathroom, or whole-home renovation projects.')
  },
  answers: { initial_description: description },
  referenceId: 'story-3-246-first-plan'
});

const offerFacts = activeMemory(db, { userId: userA, subjectId: first.subjects.offer.id });
assert(offerFacts.some(item => item.concept === 'target_audience' && item.label === 'Homeowners planning major renovations'));
assert(offerFacts.some(item => item.concept === 'current_channel' && item.label === 'Referrals'));
assert(offerFacts.some(item => item.concept === 'confirmed_offer_fact' && /kitchen.*bathroom.*whole-home/i.test(item.label)));
assert.strictEqual(offerFacts.filter(item => item.concept === 'target_audience' && item.status === 'active').length, 1);

const serviceMemory = memoryUnderstanding(db, {
  userId: userA,
  objective: 'promote_service',
  initialDescription: 'I want to improve our marketing for this service.',
  subjectId: first.subjects.offer.id
});
assert.match(serviceMemory.understanding.serviceDefinition.label, /remodeling/i);
assert.match(serviceMemory.understanding.targetAudience.label, /homeowners planning major renovations/i);
assert.strictEqual(serviceMemory.understanding.serviceChannel, undefined, 'a remembered current channel must not answer a campaign-channel question');

const serviceDiscovery = analyzeDiscovery({
  objective: 'promote_service',
  understanding: serviceMemory.understanding,
  answers: { initial_description: 'I want to improve our marketing for this service.' }
});
assert(serviceDiscovery.planningReadiness.knownRequirements.includes('service'));
assert(serviceDiscovery.planningReadiness.knownRequirements.includes('client'));
assert.notStrictEqual(serviceDiscovery.nextQuestion?.id, 'service_definition');
assert.notStrictEqual(serviceDiscovery.nextQuestion?.id, 'service_client');
assert.strictEqual(serviceDiscovery.nextQuestion?.id, 'service_problem', 'new objective-specific discovery continues');

const acquisitionMemory = memoryUnderstanding(db, {
  userId: userA,
  objective: 'get_more_customers',
  initialDescription: 'Help us get more customers for our residential remodeling business.',
  subjectId: first.subjects.offer.id
});
assert.strictEqual(acquisitionMemory.understanding.currentAcquisitionChannel.label, 'Referrals');

const projection = brandBrainProjection(db, { userId: userA });
assert(projection.current.some(item => item.displayConcept === 'Primary audience' && /homeowners/i.test(item.label)));
assert(projection.current.some(item => item.displayConcept === 'Current channel' && item.label === 'Referrals'));

for (const generic of ['This service', 'Our service', 'The service', 'This product', 'The offer', 'Consulting']) {
  const genericPromotion = promoteObjectiveMemory(db, {
    userId: userB,
    objective: 'promote_service',
    understanding: { serviceDefinition: confirmed(generic) },
    answers: { initial_description: generic },
    referenceId: `generic-${generic}`
  });
  assert(!activeMemory(db, { userId: userB, subjectId: genericPromotion.subjects.offer.id })
    .some(item => item.concept === 'confirmed_offer_fact'), `${generic} must not become a durable offer fact`);
  const genericMemory = memoryUnderstanding(db, {
    userId: userB,
    objective: 'promote_service',
    initialDescription: generic,
    subjectId: genericPromotion.subjects.offer.id
  });
  assert.strictEqual(genericMemory.understanding.serviceDefinition, undefined, `${generic} must not satisfy offer description`);
}

const audience = offerFacts.find(item => item.concept === 'target_audience');
const corrected = reconcileMemory(db, {
  userId: userA,
  recordId: audience.id,
  action: 'replace',
  value: 'Luxury homeowners planning whole-home renovations',
  label: 'Luxury homeowners planning whole-home renovations'
});
assert(corrected.valid);
assert.strictEqual(db.prepare('SELECT status FROM business_memory_records WHERE id=?').get(audience.id).status, 'superseded');
assert(activeMemory(db, { userId: userA, subjectId: first.subjects.offer.id })
  .some(item => item.concept === 'target_audience' && item.label === 'Luxury homeowners planning whole-home renovations'));
assert(!activeMemory(db, { userId: userB }).some(item => item.label.includes('Luxury homeowners')), 'tenant memory remains isolated');

const supplement = promoteObjectiveMemory(db, {
  userId: userA,
  objective: 'launch_product',
  understanding: {
    category: confirmed('Ceylon cinnamon supplement'),
    targetAudience: confirmed('Adults exploring everyday wellness')
  },
  answers: { initial_description: 'Ceylon cinnamon supplement for adults exploring everyday wellness' },
  referenceId: 'story-3-246-other-offer'
});
const supplementMemory = memoryUnderstanding(db, {
  userId: userA,
  objective: 'launch_product',
  initialDescription: 'Ceylon cinnamon supplement',
  subjectId: supplement.subjects.offer.id
});
assert(!/homeowners|remodeling/i.test(String(supplementMemory.understanding.targetAudience?.label || '')), 'offer audience cannot leak across offers');
assert(!/remodeling/i.test(String(supplementMemory.understanding.existingProductDefinition?.label || '')), 'offer description cannot leak across offers');

console.log('Story 3.246 business memory continuity tests passed');
