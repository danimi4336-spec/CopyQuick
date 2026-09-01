# Session retention

Browser sessions expire after 24 hours. The SQLite session store deletes an
expired session when that cookie is presented again and also performs bounded
retention cleanup during normal session writes.

Every 100 successful writes, one process deletes at most 250 expired rows,
oldest first. The fixed batch prevents a request from performing unbounded
database work. Cleanup failure does not invalidate the session that was just
saved; it emits only a sanitized warning and retries after another bounded
write interval.

This maintenance changes neither cookie lifetime nor authentication behavior.
It requires no scheduler, external service, schema migration, or production
operator command.
