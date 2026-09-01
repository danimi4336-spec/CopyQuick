# Browser response security

CopyQuick applies a single browser-security middleware before every route,
including static assets, redirects, errors, `/healthz`, and signed Stripe
webhooks.

The baseline prevents framing, MIME sniffing, plug-in content, untrusted base
URLs, cross-origin form submission, and access to unused camera, microphone,
and geolocation capabilities. Referrers are reduced on cross-origin requests.
Production HTTPS responses also advertise one year of HSTS. HSTS is omitted
from local development and any non-HTTPS response so localhost is not pinned.

The Content Security Policy permits the application's current same-origin
JavaScript and assets, Google Fonts, HTTPS images (including OAuth avatars),
and the existing inline scripts and styles used by EJS views. `object-src`,
`frame-ancestors`, `base-uri`, and `form-action` remain tightly restricted.

## Remaining hardening

The current views contain numerous inline scripts, inline styles, and inline
event handlers. Consequently, V1 requires `unsafe-inline` for `script-src` and
`style-src`. Removing those allowances requires a deliberate conversion to
external scripts/styles or request-scoped CSP nonces and should be handled as
a separate compatibility-tested story. Do not tighten the directives in
production without exercising login, Google OAuth, Stripe checkout/portal,
Discovery, generation, and Production Studio in a browser.
