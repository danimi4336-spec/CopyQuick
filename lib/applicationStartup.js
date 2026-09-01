const { closeHttpServer } = require('./httpShutdown');

async function stopStartedComponent(component) {
  if (!component || typeof component.stop !== 'function') return;
  try { await component.stop(); } catch (_) {}
}

async function startApplicationAfterMigrationGate({
  databaseExists,
  getDatabase,
  gateMigrationState,
  initializeRuntimeDatabase,
  startHttp,
  startProductionWorker,
  startOffsiteBackupScheduler,
  startBackupHealthWatcher,
  startBillingReconciliationScheduler = () => null,
  startOperationalHealthWatcher = () => null,
  shouldStop = () => false
}) {
  const db = databaseExists ? getDatabase() : null;
  const migrationStatus = await gateMigrationState(db, { databaseExists });
  await initializeRuntimeDatabase(db, migrationStatus);
  if (shouldStop()) return { migrationStatus, stoppedBeforeServices: true };

  let server;
  let productionWorker;
  let offsiteBackupScheduler;
  let backupHealthWatcher;
  let billingReconciliationScheduler;
  let operationalHealthWatcher;
  try {
    server = await startHttp();
    productionWorker = await startProductionWorker(db);
    offsiteBackupScheduler = await startOffsiteBackupScheduler();
    backupHealthWatcher = await startBackupHealthWatcher(db);
    billingReconciliationScheduler = await startBillingReconciliationScheduler(db);
    operationalHealthWatcher = await startOperationalHealthWatcher(db);
    return {
      server, productionWorker, offsiteBackupScheduler, backupHealthWatcher,
      billingReconciliationScheduler, operationalHealthWatcher, migrationStatus
    };
  } catch (error) {
    // Stop HTTP admission first, then unwind every successfully started
    // background component in reverse startup order. Cleanup failures must not
    // conceal the authoritative startup failure.
    try { await closeHttpServer(server); } catch (_) {}
    await stopStartedComponent(operationalHealthWatcher);
    await stopStartedComponent(billingReconciliationScheduler);
    await stopStartedComponent(backupHealthWatcher);
    await stopStartedComponent(offsiteBackupScheduler);
    await stopStartedComponent(productionWorker);
    throw error;
  }
}

module.exports = { startApplicationAfterMigrationGate };
