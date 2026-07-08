# Curva

Serverless P2P football prediction market (Pears + QVAC + WDK) — Tether Developers Cup.
Per-feature context lives under `docs/context/`; the router loads the doc whose
`globs:` match the files you touch. Keep this file a thin index — no session prose.

## Context index

| Doc | Covers |
|---|---|
| [docs/context/curva-build.md](docs/context/curva-build.md) | Whole monorepo — all packages, the Pear app, build/test/demo, sprint status |

## Quick facts

- Gates: `npm run check` (typecheck + lint + test), `npm run build`, `npm run demo`.
- Status: S0–S10 done, 141 tests green, pushed to `main`. Remaining items are
  human-only submission tasks — see [docs/SUBMISSION.md](docs/SUBMISSION.md).
