# Legal and Support Readiness Review — 2026-11-04

## Scope

Engineering reviewed the published Privacy Policy, Terms of Service, Cookie
Policy, Refund Policy, contact page, and implemented support-email behavior
against current application behavior. No material legal language was changed.

## Consistent with current implementation

- `support@copyquick.co` is used consistently in public legal and contact pages.
- Stripe is identified as the payment and subscription processor.
- Resend is identified as the transactional-email provider.
- The application does not currently set analytics or advertising cookies.
- Essential session cookies support authentication and CSRF protection.
- CopyQuick does not store complete payment-card data.
- AI-generated material is presented as requiring human review.
- Public pages do not claim a fixed support-response time or that the support
  mailbox is continuously monitored.

## Owner or qualified-legal-review decisions

The following statements are material business or legal policy and require
owner confirmation or qualified legal review before broad launch:

1. The Terms select Virginia law and Virginia courts.
2. The Terms specify an 18-or-age-of-majority eligibility threshold.
3. The Terms cap liability at fees paid during the preceding 12 months.
4. The Refund Policy promises that duplicate, incorrect, and post-cancellation
   charges are always corrected promptly and describes full-refund outcomes.
5. The Refund Policy asks customers to contact CopyQuick before a payment
   dispute; confirm this wording does not improperly discourage statutory or
   card-network rights.
6. The package declares an ISC license, but repository ownership and the desired
   source-code licensing posture have not been explicitly confirmed.
7. Confirm whether and how often `support@copyquick.co` is monitored, who owns
   incident escalation, and what response expectations may be published.
8. Confirm whether AI-input use is described precisely enough. The current
   Privacy Policy says CopyQuick may improve AI models, templates, and features,
   while the OpenAI adapter uses `store: false`; owner/legal review should align
   the policy with intended data use.

## Technical verification still required

- Send a controlled contact request to the support address and verify receipt.
- Send and complete a controlled password reset.
- Confirm retry/contained-failure telemetry without exposing recipient data.
- Verify external links and the support mailbox in the release environment.

These actions require controlled accounts/recipients and are not replaced by
the deterministic email test suite.
