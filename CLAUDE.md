# Curva

Serverless P2P football prediction market (Pears + QVAC + WDK) — Tether Developers Cup.
Per-feature context lives under `docs/context/`; the router loads the doc whose
`globs:` match the files you touch. Keep this file a thin index — no session prose.

## Context index

| Doc | Covers |
|---|---|
| [docs/context/curva-build.md](docs/context/curva-build.md) | Whole monorepo — all packages, the Pear app, the `web/` landing+docs site, build/test/demo, status |

## Quick facts

- Gates: `npm run check` (typecheck + lint + test), `npm run build`, `npm run demo`.
  Node ≥20.19/22.12/24 (default local `node` is EOL 21.7.2 — use brew node@20/25).
- Status: S0–S14 done, 237 tests green, on `origin/main`. Renamed TIFO→Curva; the
  `web/` site is live at https://curva-rouge.vercel.app (+ https://curva.playhunch.xyz).
  Next: clickable browser demo. Remaining launch items are human-only — see
  [docs/SUBMISSION.md](docs/SUBMISSION.md).
- Deploy = git only: Vercel `curva` is git-connected; **push to `main` auto-deploys
  prod**. Repo-root `vercel.json` serves `web/`. Never `vercel --prod` by hand (it
  bypasses git and drifts prod). Details in [docs/context/curva-build.md](docs/context/curva-build.md).
