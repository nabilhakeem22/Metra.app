# Deployment

Production runs on **Cloudflare Workers** (OpenNext adapter), worker **`metra-web`**,
currently served at `https://metra-web.nabil-hakeem22.workers.dev` (add a custom
domain later via the worker's **Settings → Domains**).

## How deploys happen

`.github/workflows/deploy.yml` builds and deploys the worker automatically **after
CI passes on `main`**. You should not need to run `wrangler deploy` by hand.

Manual deploy (fallback, from a machine with `wrangler login` done):

```bash
cd apps/web
NEXT_PUBLIC_APP_URL=https://metra-web.nabil-hakeem22.workers.dev npx opennextjs-cloudflare build
npx wrangler deploy
```

## One-time activation of auto-deploy

In GitHub → the repo → **Settings → Secrets and variables → Actions**:

### Variables tab → New repository variable (7)

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | copy from your local `.env` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | copy from your local `.env` (public key) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | copy from your local `.env` (public key) |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar-EG` |
| `NEXT_PUBLIC_APP_URL` | `https://metra-web.nabil-hakeem22.workers.dev` |
| `CLOUDFLARE_ACCOUNT_ID` | `0454e69f5ed32ae9b6311bc5196ef073` |
| `DEPLOY_ENABLED` | `true`  ← set this **last**, it arms the workflow |

### Secrets tab → New repository secret (1)

| Name | Value |
|------|-------|
| `CLOUDFLARE_API_TOKEN` | create in Cloudflare (below) |

**Create `CLOUDFLARE_API_TOKEN`:** Cloudflare dashboard → **My Profile → API Tokens
→ Create Token → "Edit Cloudflare Workers"** template → Account = your account →
Continue → Create Token → copy the value into the GitHub secret above.

Once `DEPLOY_ENABLED = true`, every green push to `main` deploys. Until then the
deploy job is skipped (no failed runs).

## Known issue — CI is red on the OpenNext build step (auto-deploy paused)

**Status:** the app is live and correct. Manual `wrangler deploy` (above) is the
current source of truth. Auto-deploy is fully wired (all variables + the API token
are set) but does **not** fire yet, because the deploy job is gated on CI passing
and CI is currently red — so nothing bad can ship in the meantime.

**What's green:** the entire product pipeline — lint, unit tests (db + web),
migrations, RLS/roles, seed, the P0 **cross-tenant isolation** gate, and the
action-core DB tests. All pass on a clean Linux runner.

**What's red:** only the final `Cloudflare OpenNext build (no deploy)` step
(a build-time type-check). It is not a product bug, not a data or isolation issue.

**Root cause:** both CI and deploy install dependencies with
`rm -f package-lock.json && npm install`. That line exists to dodge npm's
optional-platform-dep bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828)):
the committed lockfile is generated on Windows and omits the Linux `rollup`/`esbuild`
binaries, so a plain `npm ci` on the runner can't start vitest. Deleting the lock
and re-installing fixes that — but it also lets the toolchain **re-resolve from
scratch every run**, so `wrangler`/`@opennextjs/cloudflare` drift to versions whose
generated binding types (`Cloudflare.Env` vs the `CloudflareEnv` the code expects)
no longer match, and the build's type-check fails. Pinning those two tools to exact
versions did not fully stop the drift — the non-deterministic install is the real
problem, not any single version.

**The fix (deliberate follow-up, ~30 min, not a blind patch):**
1. Generate a genuinely Linux-correct `package-lock.json` — either run
   `npm install` inside a Linux container/WSL, or add the needed platform binaries
   (`@rollup/rollup-linux-x64-gnu`, matching `esbuild`) as **direct**
   `optionalDependencies` so npm records them in the lock regardless of host OS.
2. Commit that lockfile and switch **both** workflows from
   `rm -f package-lock.json && npm install` back to deterministic **`npm ci`**.
3. Validate on a throwaway branch (watch the CI run) before merging to `main`.

This removes the rollup bug and the version drift in one move; once CI is green the
existing deploy job fires automatically — no further wiring needed.

## Runtime secrets (already set on the worker, not in this repo)

`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM` are set as encrypted
worker secrets (Cloudflare dashboard → metra-web → Settings → Variables and
secrets). `CRON_SECRET` is added when the automation cron is enabled.
`wrangler deploy` preserves these across deploys.
