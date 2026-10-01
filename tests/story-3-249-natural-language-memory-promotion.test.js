const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const {
  activeMemory,
  brandBrainProjection,
  explicitAudienceFromDescription,
  explicitCurrentChannelsFromDescription,
  memoryUnderstanding,
  promoteObjectiveMemory,
  reconcileMemory
} = require('../lib/businessMemory');

const audience = 'Homeowners planning major renovations';
for (const statement of [
  `Our audience is ${audience}.`,
  `Our ideal customers are ${audience}.`,
  `We serve ${audience.toLowerCase()}.`,
  `Most of our customers are ${audience.toLowerCase()}.`,
  `We primarily work with ${audience.toLowerCase()}.`
]) assert.strictEqual(explicitAudienceFromDescription(statement), audience, statement);

for (const statement of [
  'Maybe our audience is homeowners planning renovations.',
  'Our audience is maybe homeowners planning renovations.',
  'We could target homeowners.',
  'I think our audience might be homeowners.',
  'CopyQuick should target homeowners.',
  "Let's try homeowners for this campaign.",
  'Homeowners may be a good audience.',
  'Book a consultation for our remodeling business.',
  'Improve the website for our company.',
  'Create a page for our service.',
  'Promote our residential remodeling business.'
]) assert.strictEqual(explicitAudienceFromDescription(statement), '', statement);

for (const statement of [
  'Most of our current customers come from referrals.',
  'Most of our business comes from referrals.',
  'We currently get most customers through referrals.',
  'Referrals are our main source of customers.',
  'Our current acquisition is mostly referrals.',
  'We rely primarily on referrals today.'
]) assert.deepStrictEqual(explicitCurrentChannelsFromDescription(statement), ['Referrals'], statement);

for (const statement of [
  'We want to try referrals.',
  'We should focus on referrals.',
  'Maybe referrals would work.',
  "Let's use referrals for this campaign.",
  'Referrals could be a good channel.',
  'I want more referral customers.',
  'We used to get most customers from referrals.',
  'Last year referrals were our main channel.',
  'Before 2024 we relied on referrals.'
]) assert.deepStrictEqual(explicitCurrentChannelsFromDescription(statement), [], statement);

assert.deepStrictEqual(
  explicitCurrentChannelsFromDescription('We used to get most of our customers from referrals, but now we use organic search.'),
  ['Organic Search']
);
assert.deepStrictEqual(
  explicitCurrentChannelsFromDescription('Most customers come from referrals and organic search.'),
  ['Referrals', 'Organic Search']
);

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrationEngine(db, { logger() {} });
const userA = Number(db.prepare("INSERT INTO users(email,name) VALUES('story3249-a@example.com','A')").run().lastInsertRowid);
const userB = Number(db.prepare("INSERT INTO users(email,name) VALUES('story3249-b@example.com','B')").run().lastInsertRowid);
const confirmed = value => ({ value, label: value, source: 'user_confirmed', confidence: 1 });
const description = `I run a residential remodeling business in Virginia. Our audience is ${audience.toLowerCase()}. Most of our current customers come from referrals.`;
const promote = (userId, referenceId) => promoteObjectiveMemory(db, {
  userId,
  objective: 'increase_conversion_rates',
  understanding: { currentOffer: confirmed('Residential remodeling consultations in Virginia') },
  answers: { initial_description: description },
  referenceId
});

const first = promote(userA, 'first-approved-plan');
promote(userA, 'repeat-approved-plan');
const offerMemory = activeMemory(db, { userId: userA, subjectId: first.subjects.offer.id });
assert.strictEqual(offerMemory.filter(item => item.concept === 'target_audience').length, 1, 'same audience is deduplicated');
assert.strictEqual(offerMemory.filter(item => item.concept === 'current_channel' && item.label === 'Referrals').length, 1, 'same channel is deduplicated');
assert(offerMemory.every(item => item.provenance === 'confirmed_fact'), 'natural-language promotion retains explicit customer provenance');

const projection = brandBrainProjection(db, { userId: userA });
assert(projection.current.some(item => item.displayConcept === 'Primary audience' && item.label === audience));
assert(projection.current.some(item => item.displayConcept === 'Current channel' && item.label === 'Referrals'));

const service = memoryUnderstanding(db, { userId: userA, objective: 'promote_service', initialDescription: 'I want to promote this service.', subjectId: first.subjects.offer.id });
assert.strictEqual(service.understanding.targetAudience.label, audience);
assert.strictEqual(service.understanding.serviceChannel, undefined, 'current acquisition does not answer campaign-channel selection');
const acquisition = memoryUnderstanding(db, { userId: userA, objective: 'get_more_customers', initialDescription: 'Help us get more customers.', subjectId: first.subjects.offer.id });
assert.strictEqual(acquisition.understanding.currentAcquisitionChannel.label, 'Referrals');

const currentAudience = offerMemory.find(item => item.concept === 'target_audience');
assert(reconcileMemory(db, { userId: userA, recordId: currentAudience.id, action: 'replace', value: 'Luxury homeowners planning whole-home renovations', label: 'Luxury homeowners planning whole-home renovations' }).valid);
assert.strictEqual(db.prepare('SELECT status FROM business_memory_records WHERE id=?').get(currentAudience.id).status, 'superseded');

const supplement = promoteObjectiveMemory(db, {
  userId: userA,
  objective: 'launch_product',
  understanding: { category: confirmed('Ceylon cinnamon supplement'), targetAudience: confirmed('Adults exploring everyday wellness') },
  answers: { initial_description: 'Ceylon cinnamon supplement for adults exploring everyday wellness' },
  referenceId: 'supplement-plan'
});
const supplementContext = memoryUnderstanding(db, { userId: userA, objective: 'launch_product', initialDescription: 'Ceylon cinnamon supplement', subjectId: supplement.subjects.offer.id });
assert(!/homeowners|remodeling/i.test(String(supplementContext.understanding.targetAudience?.label || '')));
assert.strictEqual(activeMemory(db, { userId: userB }).length, 0, 'tenant B cannot see or reuse tenant A memory');

for (const generic of ['this service', 'our service', 'the service', 'this product', 'our product', 'this offer', 'the offer']) {
  const result = promoteObjectiveMemory(db, { userId: userB, objective: 'promote_service', understanding: { serviceDefinition: confirmed(generic) }, answers: { initial_description: generic }, referenceId: generic });
  assert(!activeMemory(db, { userId: userB, subjectId: result.subjects.offer.id }).some(item => item.concept === 'confirmed_offer_fact'));
}

const views = ['build-plan.ejs', 'production-ready.ejs', 'production-studio.ejs'].map(file => fs.readFileSync(path.join(__dirname, '..', 'views', file), 'utf8')).join('\n');
assert.doesNotMatch(views, /internal prerequisite/i);
assert.doesNotMatch(views, /planning prerequisite/i);
assert.doesNotMatch(views, /production batch/i);
assert.doesNotMatch(views, />Run status</i);
assert.match(views, /supporting document/i);

console.log('Story 3.249 natural-language memory promotion tests passed');
