require('dotenv').config();
const { evaluateDeploymentReadiness } = require('../lib/deploymentReadiness');
const { inspectReleaseMigrationReadiness } = require('../lib/releaseMigrationReadiness');

const environment = evaluateDeploymentReadiness(process.env);
const migration = inspectReleaseMigrationReadiness(process.env);
const migrationFinding = migration.safe ? [] : [{
  code: migration.code,
  severity: 'blocker',
  message: migration.code === 'MIGRATION_REQUIRED'
    ? 'The database requires an explicitly authorized migration before this application can serve traffic.'
    : 'The database schema is not compatible with this application release.'
}];
const findings = [...environment.findings, ...migrationFinding];
const result = {
  ready: environment.ready && migration.safe,
  blockerCount: findings.filter(item => item.severity === 'blocker').length,
  warningCount: findings.filter(item => item.severity === 'warning').length,
  findings,
  migration
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ready) process.exitCode = 1;
