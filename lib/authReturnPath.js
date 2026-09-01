const ALLOWED_AUTH_RETURN_PATHS = new Set(['/pricing']);

function normalizeAuthReturnPath(value) {
  const path = typeof value === 'string' ? value.trim() : '';
  return ALLOWED_AUTH_RETURN_PATHS.has(path) ? path : null;
}

function authSuccessPath(user, requestedPath) {
  return normalizeAuthReturnPath(requestedPath) || (user?.builder_goal ? '/dashboard' : '/welcome');
}

module.exports = {
  ALLOWED_AUTH_RETURN_PATHS,
  authSuccessPath,
  normalizeAuthReturnPath
};
