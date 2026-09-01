const SESSION_COOKIE_NAME = 'connect.sid';

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function establishAuthenticatedSession(req, userId) {
  await regenerateSession(req);
  req.session.userId = userId;
}

function destroyAuthenticatedSession(req, res, options = {}) {
  const cookieName = options.cookieName || SESSION_COOKIE_NAME;
  const cookieOptions = options.cookieOptions || {};

  return new Promise((resolve, reject) => {
    const destroySession = () => {
      if (!req.session) {
        res.clearCookie(cookieName, cookieOptions);
        return resolve();
      }

      req.session.destroy((err) => {
        if (err) return reject(err);
        res.clearCookie(cookieName, cookieOptions);
        resolve();
      });
    };

    if (typeof req.logout !== 'function') return destroySession();
    req.logout((err) => {
      if (err) return reject(err);
      destroySession();
    });
  });
}

module.exports = {
  SESSION_COOKIE_NAME,
  destroyAuthenticatedSession,
  establishAuthenticatedSession,
  regenerateSession
};
