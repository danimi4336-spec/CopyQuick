async function startApplicationAfterMigrationGate({
  databaseExists,
  getDatabase,
  gateMigrationState,
  initializeRuntimeDatabase,
  startHttp,
  startProductionWorker,
  startOffsiteBackupScheduler,
  startBackupHealthWatcher,
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
  return { server, productionWorker, offsiteBackupScheduler, backupHealthWatcher, migrationStatus };
}

module.exports = { startApplicationAfterMigrationGate };
