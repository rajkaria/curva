# Curva — landing page

A single self-contained static page (`index.html`, no build step, no dependencies).
This is the **public face** of Curva — the app itself is a serverless Pear (P2P)
app and is *not* hosted anywhere; this page just pitches it and links the repo,
demo video, and run instructions.

## Deploy to Vercel (attach your subdomain here)

Curva has no existing Vercel project — create a new one pointed at this folder:

1. **Vercel → Add New → Project** → import `github.com/rajkaria/curva`.
2. **Root Directory:** set to `web` (this isolates the static site from the
   monorepo's `tsc` build — critical, or Vercel will try to build the whole repo).
3. **Framework Preset:** `Other`. **Build Command:** none. **Output Directory:** `.`
4. Deploy. Then **Project → Settings → Domains → Add** your subdomain.

Or from the CLI:

```bash
cd web
npx vercel        # first deploy (preview)
npx vercel --prod # promote to production, then add the domain in the dashboard
```

## Before you ship

- Replace the demo-video `href="#"` (search `TODO` in `index.html`) with the
  unlisted YouTube URL once recorded.
- The GitHub / VISION / README / LICENSE links already point at
  `github.com/rajkaria/curva`.
