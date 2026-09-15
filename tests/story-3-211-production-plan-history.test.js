const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { listProductionResumes } = require('../lib/productionResume');

const db = new Database(':memory:');
runMigrationEngine(db, { logger: () => {} });
const ownerId = Number(db.prepare("INSERT INTO users(email,name) VALUES('history-owner@example.com','Owner')").run().lastInsertRowid);
const otherId = Number(db.prepare("INSERT INTO users(email,name) VALUES('history-other@example.com','Other')").run().lastInsertRowid);

function run(userId, status, key, createdAt) {
  const id = Number(db.prepare(`
    INSERT INTO production_runs(user_id,objective,status,plan_fingerprint,idempotency_key,approved_at,strategy_snapshot,production_cost_units,created_at)
    VALUES(?,'launch_product',?,'history-plan-321100',?,CURRENT_TIMESTAMP,'{}',0,?)
  `).run(userId, status, key, createdAt).lastInsertRowid);
  db.prepare(`
    INSERT INTO production_jobs(production_run_id,deliverable_id,title,phase,sequence_order,status,strategic_direction,strategy_snapshot,dependencies)
    VALUES(?,'customer_profile','Customer Profile','define',0,?,'Define the customer.','{}','[]')
  `).run(id, status === 'completed' ? 'completed' : 'queued');
  return id;
}

const firstId = run(ownerId, 'running', 'history-first', '2026-09-14T10:00:00Z');
const secondId = run(ownerId, 'completed', 'history-second', '2026-09-14T11:00:00Z');
run(otherId, 'running', 'history-other', '2026-09-14T12:00:00Z');

const history = listProductionResumes(db, ownerId);
assert.deepStrictEqual(history.map(item => item.id), [secondId, firstId]);
assert(history.every(item => item.href === `/production/${item.id}`));
assert.strictEqual(listProductionResumes(db, otherId).length, 1);
assert.strictEqual(listProductionResumes(db, 999999).length, 0);
assert.strictEqual(listProductionResumes(db, ownerId, 1).length, 1, 'history queries are bounded');

const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'production.js'), 'utf8');
assert.match(route, /router\.get\('\/production', requireAuth/);
assert.match(route, /const history = listProductionHistoryPage\(db, user\.id/);
assert.match(route, /productionRuns: history\.items/);
const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-history.ejs'), 'utf8');
assert.match(view, /Opening a plan does not restart production or use credits/);
assert.match(view, /run\.href/);
assert.doesNotMatch(view, /<form/);
const layout = fs.readFileSync(path.join(__dirname, '..', 'views', 'layout.ejs'), 'utf8');
assert.match(layout, /href="\/production"[^>]*>[\s\S]*Production Plans/);

db.close();
console.log('Story 3.211 Production Plan History & Navigation tests passed');
