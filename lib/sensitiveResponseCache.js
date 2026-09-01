const SENSITIVE_PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/logout'
]);

function isAuthenticatedSession(req) {
  return Boolean(req.session?.userId || req.session?.passport?.user);
}

function isSensitivePath(pathname) {
  return SENSITIVE_PUBLIC_PATHS.has(pathname) || pathname.startsWith('/auth/');
}

function createSensitiveResponseCacheMiddleware() {
  return function sensitiveResponseCache(req, res, next) {
    if (isAuthenticatedSession(req) || isSensitivePath(req.path)) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  };
}

module.exports = {
  SENSITIVE_PUBLIC_PATHS,
  createSensitiveResponseCacheMiddleware,
  isAuthenticatedSession,
  isSensitivePath
};
