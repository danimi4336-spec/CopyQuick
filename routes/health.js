const express = require('express');

function createHealthRouter({ getDatabase }) {
  const router = express.Router();
  router.get('/healthz', (_req, res) => {
    try {
      const row = getDatabase().prepare('SELECT 1 AS ready').get();
      if (!row || row.ready !== 1) throw new Error('Database readiness failed.');
      return res.status(200).json({ status: 'ok' });
    } catch (_) {
      return res.status(503).json({ status: 'unavailable' });
    }
  });
  return router;
}

module.exports = { createHealthRouter };
