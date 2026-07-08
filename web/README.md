# Curva — landing page

A single self-contained static page (`index.html`, no build step, no dependencies).
This is the **public face** of Curva — the app itself is a serverless Pear (P2P)
app and is *not* hosted anywhere; this page just pitches it and links the repo,
demo video, and run instructions.

## Deploy — git is the single source of truth

The Vercel project **`curva`** is connected to `github.com/rajkaria/curva`.
**Production deploys automatically on every push to `main`.** That is the only
way the live site changes. To ship: merge to `main`, push — done.

How the static site gets served from a monorepo: the repo-root
[`vercel.json`](../vercel.json) sets `outputDirectory: "web"` and skips
install/build, so Vercel serves this folder as-is. Because that config lives in
the repo, **leave the project's Root Directory at the default (repo root)** — do
*not* set it to `web`, or the `outputDirectory` path (`web/web`) breaks.

> ⚠️ **Never run `vercel --prod` (or `vercel deploy --prod`) by hand.** The CLI
> uploads whatever is in your local folder straight to production, bypassing git
> entirely. That is exactly how prod once drifted ahead of `main` (the redesign
> was live before it was ever merged). If git isn't the source of truth, nobody
> can tell what's deployed. Push to `main` instead.

Preview deploys for a branch/PR are fine (`git push` your branch → Vercel builds
a preview URL). Domains are managed in **Project → Settings → Domains**.

## Before you ship

- Replace the demo-video `href="#"` (search `TODO` in `index.html`) with the
  unlisted YouTube URL once recorded.
- The GitHub / VISION / README / LICENSE links already point at
  `github.com/rajkaria/curva`.
