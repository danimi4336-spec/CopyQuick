const crypto = require('crypto');
const express = require('express');
const { normalizedOrigin } = require('../lib/pageMetadata');

function isTrafficOwner(user) {
  return Boolean(user?.id && String(user.id) === process.env.TRAFFIC_OWNER_USER_ID);
}

function createTrafficRouter({ getDb }) {
  const router = express.Router();

  // Mounted after session, CSRF and authenticated-user middleware.
  router.post('/traffic/visit', (req, res) => {
    if (isTrafficOwner(res.locals.user) || req.get('Sec-GPC') === '1' || req.get('DNT') === '1') {
      return res.sendStatus(204);
    }
    const { browserId, emailInvite } = req.body || {};
    if (typeof browserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(browserId)
        || typeof emailInvite !== 'boolean') {
      return res.sendStatus(400);
    }
    const hash = crypto.createHash('sha256').update(browserId).digest('hex');
    getDb().prepare(`
      INSERT INTO site_visitors (browser_hash, email_invite) VALUES (?, ?)
      ON CONFLICT(browser_hash) DO UPDATE SET email_invite = 1
      WHERE excluded.email_invite = 1 AND site_visitors.email_invite = 0
    `).run(hash, Number(emailInvite));
    return res.sendStatus(204);
  });

  router.get('/admin/traffic', (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!isTrafficOwner(res.locals.user)) return res.sendStatus(404);
    const counts = getDb().prepare(`
      SELECT COUNT(*) AS visitors, COALESCE(SUM(email_invite), 0) AS invited
      FROM site_visitors
    `).get();
    res.render('traffic', {
      title: 'Site traffic - CopyQuick', currentPage: 'traffic', counts,
      invitationUrl: normalizedOrigin(process.env.PUBLIC_APP_ORIGIN) + '/?ref=email-invite'
    });
  });
  return router;
}

module.exports = { createTrafficRouter, isTrafficOwner };
