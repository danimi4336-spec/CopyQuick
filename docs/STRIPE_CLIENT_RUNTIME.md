# Stripe Client Runtime Safety

CopyQuick configures one shared Stripe SDK client for checkout, customer portal,
webhook authority reads, and billing reconciliation. Each network attempt uses a
20-second timeout by default and the SDK may retry a network failure once.

Optional operator settings are deliberately bounded:

- `STRIPE_API_TIMEOUT_MS`: 1000–30000 milliseconds (default `20000`)
- `STRIPE_API_MAX_NETWORK_RETRIES`: 0–2 (default `1`)

Invalid or excessive values fall back to the defaults. This prevents a
configuration typo from restoring the SDK's longer request lifetime or creating
an uncontrolled retry sequence. Checkout creation retains its existing
idempotency key, and CopyQuick does not add application-level billing retries.

These settings do not enable billing and do not contain credentials. Production
still requires `STRIPE_KEY`; local development remains billing-disabled when the
key is absent.
