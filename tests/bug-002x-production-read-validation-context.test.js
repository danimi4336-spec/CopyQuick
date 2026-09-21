const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadProductionValidationContext } = require('../lib/productionValidationContext');

const job = {
  id: 44,
  production_run_id: 12,
  generation_id: 133,
  deliverable_id: 'organic_content_campaign',
  status: 'completed',
  strategy_snapshot: JSON.stringify({
    primaryCustomer: { value: 'Denver dog owners who value convenient, low-stress grooming' },
    confirmedPrimaryCta: { value: 'Schedule a mobile grooming appointment' }
  }),
  result_snapshot: null,
  dependency_job_ids: '[]'
};
const run = {
  id: 12,
  user_id: 7,
  objective: 'Improve Search Rankings',
  strategy_snapshot: JSON.stringify({
    primaryCustomer: { value: 'Denver dog owners who value convenient, low-stress grooming' },
    confirmedPrimaryCta: { value: 'Schedule a mobile grooming appointment' }
  })
};
const brand = {
  business_name: 'Denver Mobile Grooming',
  brand_voice: 'custom',
  brand_voice_custom: 'calm and practical',
  unique_value: 'In-home grooming',
  key_messages: 'Convenient appointments'
};

const db = {
  prepare(sql) {
    return {
      get(...args) {
        if (sql.includes('FROM production_jobs')) {
          assert.deepStrictEqual(args, [44, 133]);
          return job;
        }
        if (sql.includes('FROM production_runs')) {
          assert.deepStrictEqual(args, [12, 7]);
          return run;
        }
        if (sql.includes('FROM brand_brain')) {
          assert.deepStrictEqual(args, [7]);
          return brand;
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };
  }
};

let loadedJob = null;
const context = loadProductionValidationContext(db, {
  userId: 7,
  generation: { id: 133, production_job_id: 44 }
}, {
  loadDependencyOutputs(_db, parsedJob) {
    loadedJob = parsedJob;
    return [{ deliverableId: 'priority_content_brief', output: { primaryTopic: 'mobile dog grooming' } }];
  }
});

assert.strictEqual(loadedJob.id, 44);
assert.strictEqual(context.strategySnapshot.primaryCustomer.value, 'Denver dog owners who value convenient, low-stress grooming');
assert.strictEqual(context.strategySnapshot.confirmedPrimaryCta.value, 'Schedule a mobile grooming appointment');
assert.strictEqual(context.brandContext.businessName, 'Denver Mobile Grooming');
assert.strictEqual(context.brandContext.voice, 'calm and practical');
assert.strictEqual(context.deliverableId, 'organic_content_campaign');
assert.strictEqual(context.dependencyOutputs.length, 1);
assert.ok(context.compositionBrief, 'organic read validation must reconstruct the intermediate composition brief');
assert.strictEqual(loadProductionValidationContext(db, { userId: 7, generation: { id: 133 } }), null);

const generationView = fs.readFileSync(path.join(__dirname, '..', 'views', 'generation.ejs'), 'utf8');
assert.match(generationView, /source\.mode === 'ai' \? '✨ Regenerate AI Version'/,
  'an existing OpenAI result must offer regeneration rather than claiming no AI version exists');

console.log('production read validation context regression test passed');
