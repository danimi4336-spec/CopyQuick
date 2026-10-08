const assert = require('assert');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { understandBusiness } = require('../lib/businessUnderstanding');
const { analyzeDiscovery } = require('../lib/discoveryIntelligence');
const { buildBusinessReflection } = require('../lib/businessReflection');
const { buildStrategy } = require('../lib/strategyEngine');
const { buildPlan } = require('../lib/buildPlanEngine');
const { createApprovedProductionSet, createDefaultSelection } = require('../lib/buildPlanApproval');
const {
  activeMemory,
  memoryUnderstanding,
  mergeCurrentWithMemory,
  promoteObjectiveMemory,
  resolveObjectiveSubjects
} = require('../lib/businessMemory');

const confirmed = value => ({ value, label: value, source: 'user_confirmed', confidence: 1 });
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
runMigrationEngine(db, { logger() {} });
const userId = Number(db.prepare("INSERT INTO users(email,name) VALUES('story-255@example.com','Story 255')").run().lastInsertRowid);

const ceylon = promoteObjectiveMemory(db, {
  userId,
  objective: 'launch_product',
  referenceId: 'ceylon-approved-plan',
  answers: { initial_description: 'Ceylon Cinnamon Supplement' },
  understanding: {
    brand: confirmed('Northstar Goods'),
    category: confirmed('Dietary Supplement'),
    targetAudience: confirmed('Adults interested in healthy metabolic function and everyday wellness'),
    existingProductDefinition: confirmed('Ceylon Cinnamon Supplement with Cinnamomum verum, liposomal formulation, 120 softgels'),
    conceptMaturity: confirmed('Product finalized'),
    launchStage: confirmed('Ready to launch'),
    salesChannel: confirmed('Our website and Amazon')
  }
});

const arcDescription = 'We are launching a premium modular desk organizer made from recycled aluminum for professionals and home-office users who want a clean, organized workspace. The product is called Arc Desk Organizer and will be sold through our website and Amazon. We need help positioning the product and preparing the marketing for launch.';
let resolution = resolveObjectiveSubjects(db, { userId, initialDescription: arcDescription });
assert.strictEqual(resolution.selection, 'new', 'an explicit different product identity starts a new offer');
assert.strictEqual(resolution.offer, null, 'Arc must not bind to the only remembered Ceylon offer');

const arcMemoryBeforePromotion = memoryUnderstanding(db, {
  userId,
  objective: 'launch_product',
  initialDescription: arcDescription,
  subjectId: resolution.offer?.id
});
const projectedBeforePromotion = Object.values(arcMemoryBeforePromotion.understanding).map(field => field.label).join(' ');
assert.doesNotMatch(projectedBeforePromotion, /Ceylon|Cinnamomum|liposomal|120 softgels|metabolic/i);
assert.strictEqual(arcMemoryBeforePromotion.records.filter(record => record.scope_type === 'offer').length, 0, 'no prior offer records enter a new-offer objective');
assert.strictEqual(arcMemoryBeforePromotion.understanding.brand.label, 'Northstar Goods', 'legitimate business-level memory remains reusable');

resolution = resolveObjectiveSubjects(db, {
  userId,
  initialDescription: 'We are launching a modular recycled-aluminum desk organizer for home offices.'
});
assert.strictEqual(resolution.selection, 'new', 'a clearly different unnamed product is not auto-bound to Ceylon');

const ceylonFollowUp = resolveObjectiveSubjects(db, {
  userId,
  initialDescription: 'We want to improve launch messaging for the Ceylon Cinnamon Supplement.'
});
assert.strictEqual(ceylonFollowUp.selection, 'description');
assert.strictEqual(ceylonFollowUp.offer.id, ceylon.subjects.offer.id, 'same-offer continuity remains available');
const ceylonMemory = memoryUnderstanding(db, {
  userId,
  objective: 'launch_product',
  initialDescription: 'Ceylon Cinnamon Supplement follow-up',
  subjectId: ceylonFollowUp.offer.id
});
assert.match(ceylonMemory.understanding.existingProductDefinition.label, /Ceylon Cinnamon Supplement/);
assert.strictEqual(ceylonMemory.understanding.salesChannel.label, 'Our website and Amazon');
assert.strictEqual(ceylonMemory.understanding.currentAcquisitionChannel, undefined, 'one remembered channel is not projected into duplicate launch fields');

const arc = promoteObjectiveMemory(db, {
  userId,
  objective: 'launch_product',
  referenceId: 'arc-approved-plan',
  answers: { initial_description: arcDescription },
  understanding: {
    category: confirmed('Desk organizer'),
    targetAudience: confirmed('Professionals and home-office users'),
    existingProductDefinition: confirmed('Arc Desk Organizer made from recycled aluminum'),
    salesChannel: confirmed('Our website and Amazon'),
    launchStage: confirmed('Ready to launch')
  }
});
assert.strictEqual(arc.subjects.offer.canonical_key, 'arc desk organizer');
assert.notStrictEqual(arc.subjects.offer.id, ceylon.subjects.offer.id);
assert(!activeMemory(db, { userId, subjectId: arc.subjects.offer.id }).some(record => /Ceylon|Cinnamomum|liposomal/i.test(record.label)), 'Ceylon facts never enter Arc memory');
assert(!activeMemory(db, { userId, subjectId: ceylon.subjects.offer.id }).some(record => /Arc Desk|recycled aluminum/i.test(record.label)), 'Arc facts never enter Ceylon memory');

const arcFollowUp = resolveObjectiveSubjects(db, {
  userId,
  initialDescription: 'The product is called Arc Desk Organizer and we want clearer positioning.'
});
assert.strictEqual(arcFollowUp.selection, 'description');
assert.strictEqual(arcFollowUp.offer.id, arc.subjects.offer.id);

const unnamedArcFollowUp = resolveObjectiveSubjects(db, {
  userId,
  initialDescription: 'We want to improve launch messaging for our modular desk organizer.'
});
assert.strictEqual(unnamedArcFollowUp.selection, 'description', 'category identity can match a more specific remembered product identity');
assert.strictEqual(unnamedArcFollowUp.offer.id, arc.subjects.offer.id);

for (const variation of ['Ceylon Cinnamon Supplement', 'ceylon cinnamon supplement', 'liposomal Ceylon cinnamon supplement']) {
  const sameCeylon = resolveObjectiveSubjects(db, { userId, initialDescription: variation });
  assert.strictEqual(sameCeylon.offer.id, ceylon.subjects.offer.id, `${variation} remains the same offer`);
}
const relatedButDifferent = resolveObjectiveSubjects(db, {
  userId,
  initialDescription: 'We are launching a Turmeric Curcumin Supplement through our website and Amazon.'
});
assert.strictEqual(relatedButDifferent.selection, 'new', 'a named product in the same category remains a different offer');
assert.strictEqual(relatedButDifferent.offer, null);
const nameCollision = resolveObjectiveSubjects(db, {
  userId,
  initialDescription: 'The product is called Arc Desk Organizer Mini and will be sold online.'
});
assert.strictEqual(nameCollision.selection, 'new', 'a longer distinct product name is not merged by substring overlap');
assert.strictEqual(nameCollision.offer, null);
const arcMini = promoteObjectiveMemory(db, {
  userId,
  objective: 'launch_product',
  referenceId: 'arc-mini-plan',
  answers: { initial_description: 'The product is called Arc Desk Organizer Mini.' },
  understanding: { existingProductDefinition: confirmed('Arc Desk Organizer Mini') }
});
assert.notStrictEqual(arcMini.subjects.offer.id, arc.subjects.offer.id);
assert.strictEqual(resolveObjectiveSubjects(db, { userId, initialDescription: 'Arc Desk Organizer' }).offer.id, arc.subjects.offer.id);
assert.strictEqual(resolveObjectiveSubjects(db, { userId, initialDescription: 'Arc Desk Organizer Mini' }).offer.id, arcMini.subjects.offer.id);
assert.strictEqual(resolveObjectiveSubjects(db, { userId, initialDescription: 'our modular desk organizer' }).requiresSelection, true, 'an unnamed family-level reference is ambiguous without variant semantics');

const ambiguous = resolveObjectiveSubjects(db, {
  userId,
  initialDescription: 'We want to improve the launch messaging for our product.'
});
assert.strictEqual(ambiguous.requiresSelection, true, 'multiple offers require explicit disambiguation');
assert.strictEqual(ambiguous.offer, null);

const freshArcAudience = confirmed('Design-conscious remote professionals');
const rememberedArc = memoryUnderstanding(db, {
  userId,
  objective: 'launch_product',
  initialDescription: arcDescription,
  subjectId: arc.subjects.offer.id
});
const merged = mergeCurrentWithMemory({ targetAudience: freshArcAudience }, rememberedArc);
assert.strictEqual(merged.understanding.targetAudience.label, freshArcAudience.label, 'fresh explicit input outranks conflicting same-offer memory');
assert(merged.conflicts.some(conflict => conflict.field === 'targetAudience'), 'same-offer conflicts remain reviewable');
const freshArcState = mergeCurrentWithMemory({
  salesChannel: confirmed('Our website only'),
  launchStage: confirmed('In development')
}, rememberedArc);
assert.strictEqual(freshArcState.understanding.salesChannel.label, 'Our website only');
assert.strictEqual(freshArcState.understanding.launchStage.label, 'In development');
assert(freshArcState.conflicts.some(conflict => conflict.field === 'salesChannel'));
assert(freshArcState.conflicts.some(conflict => conflict.field === 'launchStage'));

const beforeIdempotentPromotion = activeMemory(db, { userId, subjectId: arc.subjects.offer.id }).length;
promoteObjectiveMemory(db, {
  userId,
  objective: 'launch_product',
  referenceId: 'arc-approved-plan-repeat',
  subjectIds: { business: arc.subjects.business.id, offer: arc.subjects.offer.id },
  answers: { initial_description: arcDescription },
  understanding: {
    category: confirmed('Desk organizer'),
    targetAudience: confirmed('Professionals and home-office users'),
    existingProductDefinition: confirmed('Arc Desk Organizer made from recycled aluminum'),
    salesChannel: confirmed('Our website and Amazon'),
    launchStage: confirmed('Ready to launch')
  }
});
assert.strictEqual(activeMemory(db, { userId, subjectId: arc.subjects.offer.id }).length, beforeIdempotentPromotion, 're-resolving and promoting the same offer does not duplicate memory');

for (let index = 0; index < 5; index += 1) {
  assert.strictEqual(resolveObjectiveSubjects(db, { userId, initialDescription: 'The product is called Arc Desk Organizer.' }).offer.id, arc.subjects.offer.id);
  assert.strictEqual(resolveObjectiveSubjects(db, { userId, initialDescription: 'Ceylon Cinnamon Supplement' }).offer.id, ceylon.subjects.offer.id);
  assert.strictEqual(resolveObjectiveSubjects(db, { userId, initialDescription: 'Improve our product launch.' }).requiresSelection, true);
}

for (const unrelated of [
  'We promote a residential remodeling service for homeowners in Virginia.',
  'We are launching accounting software for small businesses.'
]) {
  const isolated = resolveObjectiveSubjects(db, { userId, initialDescription: unrelated });
  assert.strictEqual(isolated.selection, 'new', `${unrelated} does not reuse product memory`);
  assert.strictEqual(isolated.offer, null);
}

function orderedOfferResolution(order) {
  const orderedDb = new Database(':memory:');
  orderedDb.pragma('foreign_keys = ON');
  runMigrationEngine(orderedDb, { logger() {} });
  const orderedUser = Number(orderedDb.prepare("INSERT INTO users(email,name) VALUES(?, 'Ordered')").run(`story-255-${order.join('-')}@example.com`).lastInsertRowid);
  for (const identity of order) {
    const isArc = identity === 'arc';
    promoteObjectiveMemory(orderedDb, {
      userId: orderedUser,
      objective: 'launch_product',
      referenceId: identity,
      answers: { initial_description: isArc ? arcDescription : 'Ceylon Cinnamon Supplement' },
      understanding: { existingProductDefinition: confirmed(isArc ? 'Arc Desk Organizer' : 'Ceylon Cinnamon Supplement') }
    });
  }
  const result = {
    arc: resolveObjectiveSubjects(orderedDb, { userId: orderedUser, initialDescription: 'Arc Desk Organizer' }).offer?.canonical_key,
    ceylon: resolveObjectiveSubjects(orderedDb, { userId: orderedUser, initialDescription: 'Ceylon Cinnamon Supplement' }).offer?.canonical_key,
    ambiguous: Boolean(resolveObjectiveSubjects(orderedDb, { userId: orderedUser, initialDescription: 'our product' }).requiresSelection)
  };
  orderedDb.close();
  return result;
}
assert.deepStrictEqual(orderedOfferResolution(['arc', 'ceylon']), orderedOfferResolution(['ceylon', 'arc']), 'offer resolution is independent of insertion order and recency');

const legacyDb = new Database(':memory:');
legacyDb.pragma('foreign_keys = ON');
runMigrationEngine(legacyDb, { logger() {} });
const legacyUser = Number(legacyDb.prepare("INSERT INTO users(email,name) VALUES('story-255-legacy@example.com','Legacy')").run().lastInsertRowid);
const legacySubjectId = Number(legacyDb.prepare(`INSERT INTO business_memory_subjects
  (user_id,scope_type,canonical_key,label,status,created_at,updated_at)
  VALUES (?,'offer','current-offer','Ceylon Cinnamon Supplement','active',?,?)`).run(legacyUser, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
const timestamp = new Date().toISOString();
legacyDb.prepare(`INSERT INTO business_memory_records
  (user_id,subject_id,concept,value_json,canonical_value,label,provenance,confidence,status,freshness_class,
   observed_at,source_reference_type,source_field,confirmed_at,created_at,updated_at)
  VALUES (?,?, 'confirmed_offer_fact', ?, 'ceylon cinnamon supplement', 'Ceylon Cinnamon Supplement',
   'confirmed_fact',1,'active','stable',?,'legacy_import','existingProductDefinition',?,?,?)`)
  .run(legacyUser, legacySubjectId, JSON.stringify('Ceylon Cinnamon Supplement'), timestamp, timestamp, timestamp, timestamp);
const legacySame = resolveObjectiveSubjects(legacyDb, { userId: legacyUser, initialDescription: 'Ceylon Cinnamon Supplement' });
assert.strictEqual(legacySame.offer.id, legacySubjectId, 'legacy generic identity remains usable when its label clearly matches');
const legacyDifferent = resolveObjectiveSubjects(legacyDb, { userId: legacyUser, initialDescription: arcDescription });
assert.strictEqual(legacyDifferent.selection, 'new');
assert.strictEqual(legacyDifferent.offer, null, 'legacy high-specificity memory is excluded from a different explicit offer');
assert.strictEqual(legacyDb.prepare('SELECT status FROM business_memory_records WHERE subject_id=?').get(legacySubjectId).status, 'active', 'legacy memory remains intact');
legacyDb.close();

const serviceDb = new Database(':memory:');
serviceDb.pragma('foreign_keys = ON');
runMigrationEngine(serviceDb, { logger() {} });
const serviceUser = Number(serviceDb.prepare("INSERT INTO users(email,name) VALUES('story-255-service@example.com','Service')").run().lastInsertRowid);
promoteObjectiveMemory(serviceDb, {
  userId: serviceUser,
  objective: 'promote_service',
  referenceId: 'service-plan',
  answers: { initial_description: 'Residential remodeling service in Virginia' },
  understanding: { serviceDefinition: confirmed('Residential remodeling service'), targetAudience: confirmed('Virginia homeowners') }
});
const productAfterService = resolveObjectiveSubjects(serviceDb, { userId: serviceUser, initialDescription: arcDescription });
assert.strictEqual(productAfterService.selection, 'new');
assert.strictEqual(productAfterService.offer, null, 'product identity excludes unrelated service memory');
serviceDb.close();

const isolatedDb = new Database(':memory:');
isolatedDb.pragma('foreign_keys = ON');
runMigrationEngine(isolatedDb, { logger() {} });
const isolatedUser = Number(isolatedDb.prepare("INSERT INTO users(email,name) VALUES('story-255-single@example.com','Single')").run().lastInsertRowid);
const onlyOffer = promoteObjectiveMemory(isolatedDb, {
  userId: isolatedUser,
  objective: 'launch_product',
  referenceId: 'single-offer',
  answers: { initial_description: 'Ceylon Cinnamon Supplement' },
  understanding: { existingProductDefinition: confirmed('Ceylon Cinnamon Supplement') }
});
const singleOfferAmbiguity = resolveObjectiveSubjects(isolatedDb, {
  userId: isolatedUser,
  initialDescription: 'We want to improve the launch messaging for our product.'
});
assert.strictEqual(singleOfferAmbiguity.selection, 'automatic', 'single-offer shorthand preserves continuity');
assert.strictEqual(singleOfferAmbiguity.offer.id, onlyOffer.subjects.offer.id);

isolatedDb.close();

async function verifyExactArcJourney() {
  const journeyDb = new Database(':memory:');
  journeyDb.pragma('foreign_keys = ON');
  runMigrationEngine(journeyDb, { logger() {} });
  const journeyUserId = Number(journeyDb.prepare("INSERT INTO users(email,name) VALUES('story-255-journey@example.com','Journey')").run().lastInsertRowid);
  promoteObjectiveMemory(journeyDb, {
    userId: journeyUserId,
    objective: 'launch_product',
    referenceId: 'journey-ceylon',
    answers: { initial_description: 'Ceylon Cinnamon Supplement' },
    understanding: {
      brand: confirmed('Northstar Goods'),
      category: confirmed('Dietary Supplement'),
      targetAudience: confirmed('Adults interested in healthy metabolic function and everyday wellness'),
      existingProductDefinition: confirmed('Ceylon Cinnamon Supplement with Cinnamomum verum, liposomal formulation, 120 softgels'),
      conceptMaturity: confirmed('Product finalized'),
      launchStage: confirmed('Ready to launch'),
      salesChannel: confirmed('Our website and Amazon')
    }
  });
  const resolution = resolveObjectiveSubjects(journeyDb, { userId: journeyUserId, initialDescription: arcDescription });
  const current = await understandBusiness({ objective: 'launch_product', answer: arcDescription, env: {} });
  const remembered = memoryUnderstanding(journeyDb, {
    userId: journeyUserId,
    objective: 'launch_product',
    initialDescription: arcDescription,
    subjectId: resolution.offer?.id
  });
  const merged = mergeCurrentWithMemory(current.understanding, remembered);
  assert.strictEqual(resolution.offer, null, 'the first Arc screen has no remembered-offer banner binding');
  assert.match(merged.understanding.targetAudience.label, /professionals and home-office users/i);
  assert.strictEqual(merged.understanding.salesChannel.label, 'Our website and Amazon');
  assert.strictEqual(Object.values(merged.understanding).filter(field => field?.label === 'Our website and Amazon').length, 1);
  assert.strictEqual(merged.understanding.conceptMaturity, undefined);
  assert.strictEqual(merged.understanding.launchStage, undefined);
  assert.strictEqual(analyzeDiscovery({ objective: 'launch_product', understanding: merged.understanding, answers: { initial_description: arcDescription } }).nextQuestion.id, 'business_type');
  assert.doesNotMatch(JSON.stringify(merged), /healthy metabolic|Ceylon|Cinnamomum|liposomal|120 softgels|Dietary Supplement/i);

  const arcUnderstanding = {
    businessType: confirmed('physical_product'),
    industry: confirmed('home_office_goods'),
    category: confirmed('desk_organizer'),
    targetAudience: confirmed('Professionals and home-office users'),
    customerMotivation: confirmed('A clean, organized workspace'),
    intendedOutcome: confirmed('A more organized desktop workflow'),
    conceptMaturity: confirmed('finalized'),
    existingProductDefinition: confirmed('Arc Desk Organizer made from recycled aluminum'),
    salesChannel: confirmed('multiple'),
    competitiveDifferentiation: confirmed('clear'),
    competitiveDifferentiationDetails: confirmed('Modular construction and recycled aluminum'),
    launchStage: confirmed('ready')
  };
  arcUnderstanding.salesChannel.label = 'Our website and Amazon';
  const answers = {
    initial_description: arcDescription,
    competitive_differentiation: 'clear',
    competitive_differentiation_details: 'Modular construction and recycled aluminum'
  };
  const intelligence = analyzeDiscovery({ objective: 'launch_product', understanding: arcUnderstanding, answers });
  const reflection = buildBusinessReflection({
    objective: 'launch_product',
    understanding: arcUnderstanding,
    answers,
    planningReadiness: intelligence.planningReadiness
  });
  const strategy = buildStrategy({
    objective: 'launch_product',
    understanding: arcUnderstanding,
    confirmedUnderstanding: arcUnderstanding,
    answers
  });
  const plan = buildPlan({ objective: 'launch_product', confirmedUnderstanding: arcUnderstanding, strategyResult: strategy, answers });
  assert.strictEqual(plan.readiness.ready, true);
  const approval = createApprovedProductionSet({
    plan,
    selection: createDefaultSelection(plan),
    strategyResult: strategy,
    confirmedUnderstanding: arcUnderstanding,
    memorySubjectIds: {}
  });
  assert.strictEqual(approval.valid, true);
  const downstream = JSON.stringify({ reflection, strategy, plan, productionSnapshot: approval.productionSet.strategySnapshot });
  assert.match(downstream, /Arc Desk Organizer/);
  assert.match(downstream, /recycled aluminum/i);
  assert.match(downstream, /Professionals and home-office users/i);
  assert.match(downstream, /Our website and Amazon/i);
  assert.doesNotMatch(downstream, /healthy metabolic|Ceylon|Cinnamomum|liposomal|120 softgels|Dietary Supplement/i);
  journeyDb.close();
}

verifyExactArcJourney().then(() => {
  db.close();
  console.log('Story 3.255 cross-offer Business Memory isolation tests passed');
}).catch(error => {
  db.close();
  console.error(error);
  process.exitCode = 1;
});
