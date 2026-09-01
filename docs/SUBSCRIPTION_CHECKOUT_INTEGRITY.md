# Subscription Checkout Integrity

CopyQuick creates Stripe subscription Checkout Sessions with a durable
per-user, per-plan operation key. Pricing-page refreshes, multiple tabs, and
separate authenticated browser sessions therefore replay the same Stripe
creation operation instead of opening independent subscription checkouts.

The local intent and Stripe Checkout Session share a 24-hour expiry. Stripe API
v1 retains idempotent POST results for at least that window, and Checkout
Sessions default to the same lifetime; CopyQuick also sends the explicit
expiration timestamp so a new local operation cannot overlap an older usable
session by design. A changed configured price receives a new operation key so
Stripe never sees different request parameters under one idempotency key.
The returned Stripe Session ID is retained without its URL or payload. At local
expiry, CopyQuick retrieves that session: completed sessions block a new
checkout, open sessions are resumed, and a fresh key is issued only when Stripe
authoritatively reports `expired`. Missing or ambiguous state fails closed.

References: [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
and [Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create).

The additive schema v4 table stores only internal user/plan references, the
configured Stripe price ID, a random operation key, and timestamps. It stores
the Stripe Session ID but no card data, Checkout URL, customer email, or raw
Stripe response. Existing
subscription entitlement and webhook authority remain unchanged. A user whose
local entitlement is already paid continues to be rejected before Checkout
creation.
