const assert = require('assert');
const {
  MAX_PRODUCTION_PLAN_NAME_LENGTH,
  cleanPlanName,
  deriveProductionPlanName,
  productionPlanName
} = require('../lib/productionPlanIdentity');
const { createProductionProgressSnapshot } = require('../lib/productionPlanProgress');

const session = {
  objective: 'launch_product',
  answers: {
    initial_description: 'I want to launch a reusable insulated lunch container for busy parents through Shopify.'
  }
};
assert.strictEqual(deriveProductionPlanName(session), 'Reusable Insulated Lunch Container');
assert.strictEqual(deriveProductionPlanName({
  objective: 'get_more_customers',
  answers: { initial_description: 'We offer bookkeeping services to independent contractors.' }
}), 'Bookkeeping Services');
assert.strictEqual(deriveProductionPlanName({ objective: 'launch_product', answers: {} }), 'Product Launch Plan');
assert.strictEqual(cleanPlanName('<script>alert(1)</script> https://attacker.example'), 'Script Alert 1 Script');
assert.strictEqual(cleanPlanName('person@example.com'), null);
assert(MAX_PRODUCTION_PLAN_NAME_LENGTH <= 80);

const snapshot = createProductionProgressSnapshot({
  planFingerprint: 'identity-plan-3213000',
  selectedDeliverables: [{ id: 'customer_profile', title: 'Customer Profile' }],
  strategySnapshot: { internal: 'not durable identity data' }
}, { displayName: deriveProductionPlanName(session) });
assert.strictEqual(snapshot.displayName, 'Reusable Insulated Lunch Container');
assert.strictEqual(Object.hasOwn(snapshot, 'strategySnapshot'), false);
assert.strictEqual(productionPlanName({ objective: 'launch_product' }, snapshot), snapshot.displayName);
assert.strictEqual(productionPlanName({ objective: 'launch_product' }, { displayName: '<>' }), 'Product Launch Plan');

const fs = require('fs');
const path = require('path');
const dashboard = fs.readFileSync(path.join(__dirname, '..', 'views', 'dashboard.ejs'), 'utf8');
const history = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-history.ejs'), 'utf8');
const studio = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-studio.ejs'), 'utf8');
assert.match(dashboard, /latestProduction\.planName/);
assert.match(history, /run\.planName/);
assert.match(studio, /planName/);

console.log('Story 3.213 Durable Production Plan Identity tests passed');
