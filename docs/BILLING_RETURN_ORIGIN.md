# Trusted billing return origin

Stripe Checkout success/cancel URLs and Billing Portal return URLs must be
constructed from `PUBLIC_APP_ORIGIN`, never from an incoming HTTP `Host`
header.

Production deployments with Stripe enabled must set an HTTPS origin only:

```text
PUBLIC_APP_ORIGIN=https://copyquick.co
```

Do not include a path, query string, fragment, or credentials. Startup fails
before database initialization when Stripe is enabled in production and this
value is missing or invalid. Development may omit the setting; local billing
tests then derive the origin from the local request for convenience.

Changing domains requires updating `PUBLIC_APP_ORIGIN` and the separately
managed Google OAuth callback configuration. Verify Checkout success, Checkout
cancel, and Billing Portal return navigation after any domain change.
