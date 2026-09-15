const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrationEngine } = require('../db/migrations');
const { HISTORY_PAGE_SIZE, listProductionHistoryPage } = require('../lib/productionResume');

const db = new Database(':memory:');
runMigrationEngine(db, { logger: () => {} });
const ownerId = Number(db.prepare("INSERT INTO users(email,name) VALUES('pagination-owner@example.com','Owner')").run().lastInsertRowid);
const otherId = Number(db.prepare("INSERT INTO users(email,name) VALUES('pagination-other@example.com','Other')").run().lastInsertRowid);

function insertRun(userId, status, index) {
  return db.prepare(`
    INSERT INTO production_runs(user_id,objective,status,plan_fingerprint,idempotency_key,approved_at,strategy_snapshot,production_cost_units,created_at)
    VALUES(?,'launch_product',?,'pagination-plan-3212',?,CURRENT_TIMESTAMP,'{}',0,?)
  `).run(userId, status, `${userId}-history-${index}`, `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00Z`).lastInsertRowid;
}

for (let index = 0; index < 23; index += 1) {
  insertRun(ownerId, index % 3 === 0 ? 'running' : index % 3 === 1 ? 'partially_completed' : 'completed', index);
}
insertRun(otherId, 'running', 24);

const first = listProductionHistoryPage(db, ownerId, {});
assert.strictEqual(HISTORY_PAGE_SIZE, 10);
assert.strictEqual(first.items.length, 10);
assert.strictEqual(first.totalCount, 23);
assert.strictEqual(first.totalPages, 3);
assert.strictEqual(first.page, 1);
const last = listProductionHistoryPage(db, ownerId, { page: 999 });
assert.strictEqual(last.page, 3, 'out-of-range pages clamp to the last page');
assert.strictEqual(last.items.length, 3);
const active = listProductionHistoryPage(db, ownerId, { status: 'active' });
assert(active.items.every(item => item.status === 'running'));
assert.strictEqual(active.totalCount, 8);
const recoverable = listProductionHistoryPage(db, ownerId, { status: 'recoverable' });
assert(recoverable.items.every(item => item.status === 'partially_completed'));
assert.strictEqual(recoverable.totalCount, 8);
const completed = listProductionHistoryPage(db, ownerId, { status: 'completed' });
assert(completed.items.every(item => item.status === 'completed'));
assert.strictEqual(completed.totalCount, 7);
assert.strictEqual(listProductionHistoryPage(db, ownerId, { status: 'not-valid', page: -4 }).status, 'all');
assert.strictEqual(listProductionHistoryPage(db, otherId).totalCount, 1, 'another user sees only their own history');

const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'production-history.ejs'), 'utf8');
assert.match(view, /Filter production plans/);
assert.match(view, /Needs attention/);
assert.match(view, /history\.totalPages/);
const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'production.js'), 'utf8');
assert.match(route, /listProductionHistoryPage\(db, user\.id/);
assert.doesNotMatch(route.slice(route.indexOf("router.get('/production'"), route.indexOf("router.get('/production/review'")), /UPDATE|INSERT|DELETE/);

db.close();
console.log('Story 3.212 Production History Pagination & Status Filtering tests passed');
