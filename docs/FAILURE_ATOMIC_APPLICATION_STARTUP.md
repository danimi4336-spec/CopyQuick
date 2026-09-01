# Failure-Atomic Application Startup

After the migration compatibility gate and runtime database initialization,
CopyQuick starts HTTP admission and background services in a defined order. If
any later service cannot start, the lifecycle closes HTTP admission and stops
every component that already started in reverse order before propagating the
original failure. A cleanup error is contained and never replaces the startup
diagnostic.

Only after this rollback completes may the top-level server lifecycle release
the SQLite runtime ownership lock. This prevents a partially started HTTP
server or Production worker from continuing to use SQLite after ownership has
been released. No migration or schema change is involved.
