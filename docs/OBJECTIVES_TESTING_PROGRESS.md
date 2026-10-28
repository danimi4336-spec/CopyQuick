# Objectives Testing Progress

Last reviewed: 2026-10-27

Complete repository suite: 254 test files

## Current objective matrix

| Objective | Registered journey | Deterministic acceptance | Controlled live-provider acceptance |
| --- | --- | --- | --- |
| Launch a New Product | Complete | Passing | Representative bounded generation passed 2026-10-27 |
| Get More Customers | Complete | Passing | Representative bounded generation passed 2026-10-27 |
| Increase Conversion Rates | Complete | Passing | Representative bounded generation passed 2026-10-27 |
| Improve Search Rankings | Complete | Passing | Representative bounded generation passed 2026-10-27; extensive search/editorial acceptance also recorded |
| Build My Brand | Complete | Passing | Representative bounded generation passed 2026-10-27 |
| Promote My Service | Complete | Passing | Initial `service_page` safely rejected; identical diagnostic generation passed |
| Validate My Idea | Complete | Passing | Representative bounded generation passed 2026-10-27 |

Every available objective registers Discovery, Strategy, Build Plan, Production, generation, validation, presentation, persistence, and acceptance policies. The cross-objective matrix verifies isolation, safe exclusions, dependency ordering, contract validation, rendering, persistence, and deterministic provider boundaries.

Story 3.264 adds a disposable owner-scoped lifecycle gate across the same seven sanitized scenarios. It verifies canonical saved-plan persistence and resume, cross-owner denial, planning-only zero-usage behavior, idempotent Production initialization, dependency-ordered deterministic execution, stored output validation, public presentation sections, exact usage units, and absence of generation-request or Business Memory side effects. It also corrected Get More Customers plans so scenarios without any available ready asset are truthfully planning-only and remain saveable.

## Shared regression coverage

- Offer-scoped Business Memory and cross-offer isolation
- Read-only Discovery, Reflection, Strategy, and Build Plan GET behavior
- Explicit CSRF-protected preparation, save, approval, and Production actions
- Planning-only, executable, saved, resumed, partially completed, and completed plans
- Dependency graphs, retry/recovery, idempotency, and atomic usage accounting
- Historical contract compatibility and fail-closed unsafe artifact handling
- Evidence provenance, research boundaries, editorial repair, and safe Markdown
- Owner/tenant isolation, stored-XSS protection, cache controls, and response safety
- Disposable database isolation and production-storage rejection

## Improve Search Rankings evidence

Improve Search Rankings has the most extensive recorded live-provider validation. Previous acceptance covered cross-industry search composition, claim-level provenance, deterministic fallback, bounded AI revision, saved-result reconstruction, regeneration, credit accounting, and customer-readable exports. Those findings are protected by objective-specific and shared regression tests.

Historical live-provider evidence is not treated as blanket acceptance for other objectives or as permanent evidence for a future release. The 2026-10-27 bounded gate, its observed service-page rejection, and the passing diagnostic generation are recorded in [Live Objective Acceptance — 2026-10-27](LIVE_OBJECTIVE_ACCEPTANCE_2026-10-27.md). Each release candidate must still pass the current deterministic suite and any explicitly authorized live acceptance gate.

## Next validation phase

1. Establish release-environment provider, usage, credit, and database baselines.
2. Exercise the browser-authenticated workflow with dedicated controlled accounts.
3. Verify content quality, exports, retries, and recovery against the release candidate.
4. Compare all post-run counters and record provider cost and credit effects.
5. Preserve objective-specific regressions for every defect found.

No live-provider execution should occur from automated CI or without explicit authorization.
