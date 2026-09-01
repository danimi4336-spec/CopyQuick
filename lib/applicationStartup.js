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

  const server = await startHttp();
  const productionWorker = await startProductionWorker(db);
  const offsiteBackupScheduler = await startOffsiteBackupScheduler();
  const backupHealthWatcher = await startBackupHealthWatcher(db);
  const billingReconciliationScheduler = await startBillingReconciliationScheduler(db);
  const operationalHealthWatcher = await startOperationalHealthWatcher(db);
  return {
    server, productionWorker, offsiteBackupScheduler, backupHealthWatcher,
    billingReconciliationScheduler, operationalHealthWatcher, migrationStatus
  };
}

module.exports = { startApplicationAfterMigrationGate };
