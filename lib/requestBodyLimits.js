// Browser forms contain at most a handful of bounded business fields. Keep the
// transport envelope comfortably above those limits without accepting the
// framework's default implicitly. Stripe receives its own raw, signed envelope
// before the browser parsers and is bounded independently.
const BROWSER_REQUEST_BODY_LIMIT = '64kb';
const STRIPE_WEBHOOK_BODY_LIMIT = '256kb';

module.exports = {
  BROWSER_REQUEST_BODY_LIMIT,
  STRIPE_WEBHOOK_BODY_LIMIT
};
