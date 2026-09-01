const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  "connect-src 'self'"
].join('; ');

const HSTS_MAX_AGE_SECONDS = 31536000;

function createBrowserSecurityMiddleware({ env = process.env } = {}) {
  const production = env.NODE_ENV === 'production';

  return function browserSecurity(req, res, next) {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    if (production && req.secure) {
      res.setHeader(
        'Strict-Transport-Security',
        `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`
      );
    }

    next();
  };
}

function configureBrowserSecurity(app, options = {}) {
  app.disable('x-powered-by');
  app.use(createBrowserSecurityMiddleware(options));
}

module.exports = {
  CONTENT_SECURITY_POLICY,
  HSTS_MAX_AGE_SECONDS,
  configureBrowserSecurity,
  createBrowserSecurityMiddleware
};
