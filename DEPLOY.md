# Deploying Metra (staging) to Vercel

This deploys the **P0 foundations** build to a public URL via Vercel's GitHub
integration. It is a **staging/preview** deploy — auth, the bilingual shell, and
the PDF spike — not a production launch. Data lives in Supabase **eu-west-1
(Ireland)**; the PDPL production-residency decision (PRD §10 #1) is still open.

Region is pinned to `dub1` (Dublin) in `apps/web/vercel.json` to sit next to the
Supabase project.

---

## 1. Import the repo into Vercel

1. Go to <https://vercel.com/new> and sign in (GitHub).
2. **Import** `nabilhakeem22/Metra.app`. Authorize Vercel for the repo if asked.
3. **Root Directory** → set to **`apps/web`** (click *Edit* next to Root
   Directory and pick `apps/web`). This is required — the app is a workspace.
4. **Framework Preset** → should auto-detect **Next.js**. Leave Build & Install
   commands on their defaults; Vercel installs the npm workspace from the repo
   root automatically.
   - *Fallback if the build can't resolve `@metra/db`:* set Install Command to
     `npm install --prefix ../..` (installs from the monorepo root).
5. Do **not** deploy yet — add the environment variables first (next section),
   or the first build will succeed but the app will 500 at runtime.

## 2. Environment variables (Project → Settings → Environment Variables)

Add these for **Production** (and Preview if you want branch deploys). Copy the
values from your local `C:\Users\HP\merta\.env` — do not commit them.

| Key | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret — server only** |
| `DATABASE_POOL_URL` | **required at runtime** — transaction pooler `:6543`, `prepare:false`. This is what the deployed app connects with. |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar-EG` |
| `DATABASE_URL` | optional — session pooler `:5432`, only needed if you ever run migrations from a build step (we don't; migrations run from your machine). |

> The password inside the connection strings is URL-encoded (`@` → `%40`) — copy
> the string exactly as it appears in `.env`.

## 3. Point Supabase Auth at the Vercel domain

After the first deploy you'll get a URL like `https://metra-xxxx.vercel.app`.
OTP login will NOT work until Supabase knows about it:

1. Supabase dashboard → **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel URL.
3. Add these to **Redirect URLs**:
   - `https://<your-vercel-domain>/**`
   - keep `http://localhost:3000/**` for local dev.
4. If you use email OTP in production, configure a real **SMTP** provider under
   Authentication → Emails (Supabase's built-in email is rate-limited and not
   for production).

## 4. Deploy & smoke-test

Trigger the deploy (it re-deploys automatically on every push to `main`). Then
check the live URL:

- `…/ar-EG` → renders RTL, heading **ميترا**
- `…/en` → renders LTR, heading **Metra**
- `…/en/login` → OTP form loads
- `…/api/pdf/spike` while logged out → **401** (auth gate)

## Known risks / things to watch

- **PDF endpoint (`/api/pdf/spike`) may OOM on serverless.** `@sparticuz/chromium`
  is memory-hungry. If that route 500s or times out, raise its memory: Project →
  Settings → **Functions** → increase memory (Hobby caps at 1024 MB; Pro allows
  up to 3009 MB). `maxDuration` is already set to 30s in the route.
- **This is staging.** Don't onboard real client data until the PDPL hosting
  decision is made (EU vs Egypt residency).
- **`metra.app` domain** — the PDF footer references it; confirm you can secure
  that domain before it appears on anything client-facing.

## Local dev note

`next dev` doesn't auto-load the monorepo-root `.env`; a copy lives at
`apps/web/.env.local` (gitignored). A cleaner fix (a dev script that loads the
root env) is a small follow-up.
