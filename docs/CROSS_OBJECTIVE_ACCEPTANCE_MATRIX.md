# Cross-objective acceptance matrix

The executable matrix is `tests/phase-4-cross-objective-quality.test.js`. It exercises every registered objective through Discovery readiness, Strategy, Build Plan, every dependency-ordered deterministic production contract, structured validation, and presentation rendering. It also rejects malformed output, checks objective-context isolation, and applies objective-specific evidence rules for search and service promotion.

Shared persistence, approval, restart, retry, stale-dependency reconciliation, AI revision, and prompt-boundary behavior remain covered by Stories 3.7, 3.8, 3.9, 3.10, 3.11, 3.202, 3.203, 3.206, 3.208, 3.209, 3.210, 3.211, 3.212, 3.213, 3.214, and 3.218. Those paths consume the same centralized objective and production contracts used by the matrix.

No live-AI result is a release prerequisite. A controlled live-AI evaluation may run only when the provider credential and explicit live execution mode are configured; otherwise deterministic acceptance is the authoritative repeatable gate.
