const express = require('express');

function createHealthRouter({ getDatabase }) {
  const router = express.Router();
  router.get('/livez', (_req, res) => res.status(200).json({ status: 'ok' }));

  function databaseReadiness(_req, res) {
    try {
      const row = getDatabase().prepare('SELECT 1 AS ready').get();
      if (!row || row.ready !== 1) throw new Error('Database readiness failed.');
      return res.status(200).json({ status: 'ok' });
    } catch (_) {
      return res.status(503).json({ status: 'unavailable' });
    }
  }

  router.get('/healthz', databaseReadiness);
  router.get('/readyz', databaseReadiness);
  return router;
}

module.exports = { createHealthRouter };
