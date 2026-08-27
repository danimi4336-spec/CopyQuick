#!/usr/bin/env node
require('dotenv').config();
const { inspectStorageHealth } = require('../lib/storageHealth');

try {
  const health = inspectStorageHealth();
  const event = health.status === 'critical' ? 'storage_critical'
    : health.status === 'warning' ? 'storage_warning' : 'storage_health_ok';
  console.log(JSON.stringify({ event, ...health }, null, 2));
  const offsiteStatus = health.offsiteBackup?.status;
  process.exitCode = health.status === 'critical' || ['critical', 'never_succeeded'].includes(offsiteStatus)
    ? 2
    : health.status === 'warning' || offsiteStatus === 'warning' ? 1 : 0;
} catch (error) {
  console.error(`Storage health inspection failed: ${error.code || 'STORAGE_HEALTH_FAILED'}`);
  process.exitCode = 1;
}
