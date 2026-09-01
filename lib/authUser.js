const AUTH_USER_COLUMNS = [
  'id',
  'email',
  'name',
  'plan_tier',
  'avatar_url',
  'generations_used',
  'monthly_limit',
  'stripe_customer_id',
  'created_at'
];

const { destroyAuthenticatedSession } = require('./authSession');
const { getSessionCookieClearOptions } = require('./sessionConfig');

function getAuthenticatedUserById(db, userId) {
  return db.prepare(`
    SELECT ${AUTH_USER_COLUMNS.join(', ')}
    FROM users
    WHERE id = ?
  `).get(userId);
}

function getAuthenticatedUserId(req) {
  return req.session?.userId || req.session?.passport?.user || req.user?.id || null;
}

function createAuthenticatedUserMiddleware(options = {}) {
  const getDatabase = options.getDb;
  if (typeof getDatabase !== 'function') {
    throw new TypeError('createAuthenticatedUserMiddleware requires getDb');
  }

  const cookieOptions = options.cookieOptions || getSessionCookieClearOptions(options.env || process.env);

  return async function loadAuthenticatedUser(req, res, next) {
    try {
      const userId = getAuthenticatedUserId(req);
      if (!userId) {
        res.locals.user = null;
        return next();
      }

      const user = getAuthenticatedUserById(getDatabase(), userId);
      if (user) {
        res.locals.user = user;
        return next();
      }

      await destroyAuthenticatedSession(req, res, { cookieOptions });
      req.session = null;
      req.user = null;
      res.locals.user = null;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  AUTH_USER_COLUMNS,
  createAuthenticatedUserMiddleware,
  getAuthenticatedUserId,
  getAuthenticatedUserById
};
