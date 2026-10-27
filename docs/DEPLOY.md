# Deployment

Production runs on **Cloudflare Workers** (OpenNext adapter), worker **`metra-web`**,
currently served at `https://metra-web.nabil-hakeem22.workers.dev` (add a custom
domain later via the worker's **Settings → Domains**).

## The system, in one picture

Everything below assumes these. Nobody had written them down in one place.

| thing | value |
|---|---|
| Host | Cloudflare Workers, worker **`metra-web`**, built from `apps/web` by `@opennextjs/cloudflare` |
| URL | `https://metra-web.nabil-hakeem22.workers.dev` (a custom domain is added on the worker's **Settings -> Domains**) |
| Postgres | Supabase `eu-west-1`, reached through the **Hyperdrive** binding to the **session pooler `:5432`**. The Worker never dials Supabase directly |
| Files | Supabase Storage, private `metra-files` bucket, signed URLs |
| PDF | `@cloudflare/puppeteer` on the **`BROWSER`** binding (Cloudflare Browser Rendering) - **not** a bundled Chromium |
| Rate limit | the Workers Rate Limiting bindings in `apps/web/wrangler.jsonc` (`ratelimits`). A binding **error** (or a limiter that does not answer in time) **fails open**; a binding **missing** on Cloudflare is a misdeployed Worker and the surface **refuses** rather than serve unlimited. The Public API contract is [API.md](API.md); the studio read budgets have a smoke test under *The rescue ledger and the studio read budgets* |
| Cron | worker **`metra-cron`** (`workers/cron`), a separate wrangler project outside the npm workspaces. Needs `APP_ORIGIN` and a `CRON_SECRET` matching `metra-web`'s |
| Deploy trigger | `deploy.yml`, on `workflow_run` of **CI** on `main`, gated on the repository variable **`DEPLOY_ENABLED == 'true'`** |
| Rollback lever | **`npx wrangler rollback <version-id>`** on the Worker (from `apps/web`) - not a git revert. The command and what it does not undo are under *Rolling back* |
| Logs | `npx wrangler tail metra-web` / `npx wrangler tail metra-cron` |

## How a deploy happens

`.github/workflows/deploy.yml` builds and deploys the worker automatically **after
CI passes on `main`**. You should not need to run `wrangler deploy` by hand.

Manual deploy (fallback, from a machine with `wrangler login` done):

The build carries `--dangerouslyUseUnsupportedNextVersion` until the Next 16
upgrade: OpenNext refuses Next 15 after its support window ended on Oct 21
2026, and the flag skips only that date check (owner decision, Oct 22).

```bash
cd apps/web
NEXT_PUBLIC_APP_URL=https://metra-web.nabil-hakeem22.workers.dev npx opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion
node scripts/emit-static-pages.mjs
npx wrangler deploy
```

Auto-deploy is **on** and has been since commit `a2e9b6c`: a green CI run on
`main` triggers `deploy.yml`, which builds and `wrangler deploy`s the worker.
`DEPLOY_ENABLED` must be `true` or the deploy job is skipped, so a merge with
the flag unset ships nothing and reports nothing.

### Static pages are served before the Worker

On the Workers Free plan every Worker request may use 10 ms of CPU, and a
request over it fails with Error 1102. So `/`, `/ar-EG`, `/en`, `/ar-EG/login`,
`/en/login`, `/robots.txt`, `/sitemap.xml` and the icons never reach the
Worker: they are static assets, which Cloudflare serves before the Worker runs,
at no CPU cost.

- `/` is `apps/web/public/index.html`, a tiny page that picks the locale in the
  browser (the `NEXT_LOCALE` cookie, then the browser's languages, then
  `ar-EG`).
- The landing and login pages are pre-rendered at build time.
  `scripts/emit-static-pages.mjs` copies their HTML into `.open-next/assets`
  (OpenNext does not). It runs after the OpenNext build in both workflows and
  fails the build if a page stopped being static. A manual build without it
  still works, but the Worker renders those pages again, 1102s and all.
- `robots.txt` and `sitemap.xml` are pre-rendered route handlers
  (`app/robots.ts`, `app/sitemap.ts`). Next writes their bodies to
  `.next/server/app/robots.txt.body` and `.next/server/app/sitemap.xml.body`,
  and the same script copies them to `.open-next/assets`. This matters more
  than CPU: a `robots.txt` that answers 1102 or 5xx makes Google pause crawling
  the whole site.

Three rules keep this working:

1. **Never make a server action reachable from the landing or login page.**
   Next posts a server action to the current page URL, and Cloudflare answers
   any POST to a static asset with **405 Method Not Allowed**. It works in
   `next dev` (no asset layer) and breaks only in production. That is why
   sign-in posts to `/api/auth/otp/send` and `/api/auth/otp/verify`.
   `src/test/static-pages.test.ts` fails if an action module becomes reachable.
2. **Never set `run_worker_first` or `not_found_handling`** on the `assets`
   block of `wrangler.jsonc`. The first sends every request through the Worker
   again. `not_found_handling: "single-page-application"` would answer every
   unknown navigation with `index.html`, the `/` redirector.
   `src/test/wrangler-assets.test.ts` fails on either.
3. **Keep both pages free of request-time APIs** (`cookies()`, `headers()`, the
   Supabase server client). They export `dynamic = 'error'`, so the build fails
   rather than quietly rendering them per request.

### Search engines: what may be indexed

Only the two landing pages, `/ar-EG` and `/en`, are indexable. The list lives
in `apps/web/src/lib/seo/indexable-pages.ts`, and the sitemap, the landing's
hreflang links and the noindex exemption all read it.

- **Noindex everywhere else.** The middleware sets `X-Robots-Tag: noindex,
  nofollow` on every response it returns except the landing pages
  (`src/lib/middleware/response-headers.ts`), the 404 and the redirects
  included. The login pages are static assets the middleware never sees, so
  `apps/web/public/_headers` sets the same header on them. Every private page
  also carries the robots meta (`src/test/private-metadata-coverage.test.ts`).
- **robots.txt has two groups.** Every crawler, AI crawlers included, may read
  the landing pages and none may read `/api/` or a signed-in section. Googlebot
  and Bingbot may also fetch the client links (`/c`, `/d`, `/invite`, `/p`,
  `/v`): they then see the noindex and drop a leaked link from the index. The
  login pages stay crawlable for the same reason. A new top-level route folder
  fails `src/app/robots.test.ts` until it is added to
  `src/lib/seo/private-paths.ts`.
- **The sitemap date** is `LANDING_LAST_MODIFIED` in `indexable-pages.ts`, never
  the build time. Bump it in the PR that changes the landing copy.
- **Every absolute URL comes from `NEXT_PUBLIC_APP_URL`** (canonical, hreflang,
  `og:image`, sitemap, robots). Moving to a custom domain needs no code change:
  add it as a Workers Custom Domain on `metra-web`, set the
  `NEXT_PUBLIC_APP_URL` Actions variable to it, deploy, then update the Supabase
  Auth Site URL and redirect URLs.
- **Search Console and Bing verification.** Set the optional Actions variables
  `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` and/or
  `NEXT_PUBLIC_BING_SITE_VERIFICATION` to the token alone (the `content` value
  of the meta tag the console shows you), then deploy. The tag goes into the
  landing pages and into `/`. A token outside `[A-Za-z0-9_-]`, or shorter than
  10 or longer than 100 characters, fails the build on purpose, and the error
  names the variable (usually the whole meta tag was pasted). Blank means no
  tag.

### Security headers: who owns which

Every page response carries the same security headers, from ONE module, on two
paths:

- **Worker responses** get them in the middleware (`src/middleware.ts`), the one
  hook that also adds the noindex header. The values, and which of three
  profiles a path gets, live in `src/lib/http/security-headers.ts`; the CSP
  directives live in `src/lib/http/content-security-policy.ts`.
  - `page`: HSTS (`max-age=31536000; includeSubDomains`), `nosniff`,
    `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
    a `Permissions-Policy`, an ENFORCED CSP and a Report-Only CSP.
  - `token_page` (`/c`, `/d`, `/invite`, `/p`, `/v` and everything under them):
    the same, with `Referrer-Policy: no-referrer`, so the token in the path never
    rides a Referer header to another site.
  - `file` (a client-page picture or document): HSTS, `nosniff`, `DENY` and
    `no-referrer` only. No CSP: `object-src 'none'` on an inline PDF risks
    Chrome's PDF viewer.
- **Static assets** (`/`, the landing and login pages, `/_next/static`, icons)
  never reach the Worker. The `/*` block at the top of `apps/web/public/_headers`
  carries the same `page` set. `src/test/static-headers.test.ts` fails if that
  block differs from the module, or if any other block sets one of its header
  names (Cloudflare comma-joins a header two matching rules both set, which
  would break the policy).
- **`/api/*`** is outside the middleware. The Public API adds `cache-control:
  no-store` and `x-content-type-options: nosniff` to every answer itself.

**The CSP is two policies on purpose (owner decision D1).** The enforced one has
only the four directives that cannot break a Next app (`frame-ancestors 'none';
base-uri 'self'; object-src 'none'; form-action 'self'`). The full fetch policy
is `Content-Security-Policy-Report-Only`, with no report endpoint: a violation
only shows in the browser console. Once a console walk of every flow and a week
of real use show none, the follow-up moves it into the enforced header (one
constant plus the `_headers` line). Rolling back an enforced directive is the
same edit the other way.

**Never add a security header in `next.config.mjs` `headers()`.** OpenNext gives
those PRIORITY over middleware headers, so a global `Referrer-Policy` there
would silently overwrite the token routes' `no-referrer`.

### Two things that were fixed to get here

History, so the setup is not accidentally reverted.

1. **Deterministic install.** Both workflows use **`npm ci`** against the committed
   `package-lock.json` — never `rm -f package-lock.json && npm install`. The old
   re-resolve-every-run approach let `wrangler`/`@opennextjs/cloudflare` drift to
   versions with an incompatible generated-types shape, breaking the build. The
   committed lockfile is **cross-platform**: it carries real installable entries
   (`resolved`+`integrity`) for the Linux *and* Windows native binaries
   (`rollup`/`esbuild`/`swc`). It was generated by a full `npm install` on a Linux
   runner. ⚠️ **If you ever need to regenerate the lock, do it on Linux (WSL, a
   container, or a throwaway CI job) — a plain `npm install` on Windows drops the
   Linux binaries and `npm ci` on the runner will fail with
   `Cannot find module '@rollup/rollup-linux-x64-gnu'`** ([npm/cli#4828](https://github.com/npm/cli/issues/4828)).

2. **CloudflareEnv typings.** The build step generates the gitignored bindings d.ts
   with the exact local command —
   `wrangler types --env-interface=CloudflareEnv ./cloudflare-env.d.ts`. Plain
   `wrangler types` emits a `Cloudflare.Env`/global `Env` shape instead of the
   `interface CloudflareEnv` the code (`cfEnv(): CloudflareEnv`) and OpenNext expect,
   which fails tsc on `Property 'HYPERDRIVE' does not exist on type 'CloudflareEnv'`.
   Keep the `--env-interface` flags in both `ci.yml` and `deploy.yml`.

### Re-arming auto-deploy if the repo variables are ever lost

Auto-deploy is already on; what follows is the recovery procedure, not a to-do.
In GitHub -> the repo -> **Settings -> Secrets and variables -> Actions**:

#### Variables tab → New repository variable (7, plus 2 optional)

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | copy from your local `.env` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | copy from your local `.env` (public key) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | copy from your local `.env` (public key) |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `ar-EG` |
| `NEXT_PUBLIC_APP_URL` | `https://metra-web.nabil-hakeem22.workers.dev` |
| `CLOUDFLARE_ACCOUNT_ID` | `0454e69f5ed32ae9b6311bc5196ef073` |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | optional: the Search Console token alone (see "Search engines" above) |
| `NEXT_PUBLIC_BING_SITE_VERIFICATION` | optional: the Bing Webmaster `msvalidate.01` token alone |
| `DEPLOY_ENABLED` | `true`  ← set this **last**, it arms the workflow |

#### Secrets tab → New repository secret (1)

| Name | Value |
|------|-------|
| `CLOUDFLARE_API_TOKEN` | create in Cloudflare (below) |

**Create `CLOUDFLARE_API_TOKEN`:** Cloudflare dashboard → **My Profile → API Tokens
→ Create Token → "Edit Cloudflare Workers"** template → Account = your account →
Continue → Create Token → copy the value into the GitHub secret above.
Set `DEPLOY_ENABLED` **last**: it is the flag that arms the workflow.

## The pre-merge database step

Run `npm run db:migrate`, then `npm run db:apply-rls` (RLS, roles and functions
live there, never in a migration).

`db:apply-rls` **verifies itself now.** After the nineteen files it re-reads
`pg_class`, `pg_policies`, `pg_trigger`, `pg_proc` and `pg_roles` on the same
connection and exits **1** listing anything the manifest declares that the
database does not have: every schema table RLS-enabled **and** forced, all 58
policies, all 17 triggers, all 46 functions, and `metra_app` present and neither
LOGIN nor BYPASSRLS. A green run ends with `apply-rls: verified in the
catalogues — 58 tables, 58 policies, 17 triggers, 46 functions, ...` (from
0063; each runbook below quotes the figures of its own day). Before
this, the only post-condition was that no statement threw — which says a file
RAN, not that its objects exist. Indexes and constraints are deliberately **not**
checked here: they carry the 0017 case-fold drift and would be red on every
database, which is why they stay report-only in `assert-schema-applied`.

Every statement under `rls/` is idempotent, so the fix for a red verification is
to re-run the command.

Then, **every time a migration is in the diff**, prove it landed:

```bash
npm run assert-schema-applied -w @metra/db
```

It reads `information_schema` (one connection, writes nothing) and compares it
against every column the drizzle schema declares. Exit 0 means the database is
ready for this code; exit 1 lists exactly what is missing.

`deploy.yml` cannot do this for you: it holds `CLOUDFLARE_API_TOKEN` and no
database credential at all, which is deliberate — a deploy workflow that can
reach production Postgres is a larger blast radius than the check is worth.

**Deploying before migrating is not a degraded state for the engagement module,
it is a TOTAL one.** Drizzle builds an explicit column list from the schema file,
so a single missing column fails the WHOLE query with 42703
(`undefined_column`). Measured against the live database at 0048: `select()` on
`engagement_events` raises 42703 for `acknowledged_issue_at`, and on
`engagement_transitions` for `idempotency_key`. `loadGuardFacts` full-row-selects
both, so every transition fails, and with them the timeline, the ROM badge and
the corrections path — eight call sites. There is no partial symptom to notice
first; the module stops.

## Runtime secrets (set on the Worker, never in this repo)

`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`
and `SHARE_LINK_SECRET` are encrypted Worker secrets. `wrangler deploy`
preserves them across deploys. `SHARE_LINK_SECRET` is the one with its own
procedure and its own rotation consequence: see *0056 and the Round B database
step* under Migrations.

They are read at **request time** through `runtimeSecret()`
(`apps/web/src/lib/cf/secrets.ts`), off the Worker's per-request `env`.

**What actually bakes a secret in is a `.env*` FILE present when the build
runs.** OpenNext compiles those files (`compile-env-files`) into
`.open-next/cloudflare/next-env.mjs`, and that module ships inside the deployed
artifact. It is not "`process.env` in server code" that does it: at runtime
OpenNext's `populateProcessEnv` copies every Worker var and secret into
`process.env` at the start of each request, so `process.env.X` works on the
Worker too. The rule is therefore simple and mechanical:

> **No `.env*` file in a CI or deploy build.**

`apps/web/scripts/assert-no-baked-secrets.mjs` enforces it right after the build
in both `ci.yml` and `deploy.yml`: it fails if any non-`NEXT_PUBLIC_` key was
assigned in that module, if it can no longer parse the module at all, or if a
secret-SHAPED value (a service-role JWT, a `re_…` Resend key, a Postgres URL
with a password) turns up anywhere under `.open-next`. Neither workflow supplies
anything but `NEXT_PUBLIC_*`, and `.env` is gitignored, so a green build is the
evidence.

Three consequences worth knowing:

- **Rotation does not need a rebuild.** `wrangler secret put` and the next
  request picks up the new value.
- **A new secret must be added as a Worker secret, not as a build env var.**
  A build var would be inlined, and the assert script would fail the build —
  which is the intended outcome, not a bug to work around.
- **A local `opennextjs-cloudflare deploy` with a `.env` present bypasses all of
  this.** Deploy through `deploy.yml`; that is why it exists.

### Rotating a secret (owner only)

Owner action: these values are not in the repo and not in CI. From
`apps/web`, one at a time:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # paste at the prompt
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM
npx wrangler secret put CRON_SECRET
```

Never pass a value as a command argument (it lands in shell history) and never
echo one into a log. After rotating, hit any authenticated page to confirm the
app still reaches Postgres and storage; a bad service-role key surfaces as a
failure to mint signed file URLs, not as a login failure.

`CRON_SECRET` is shared with the scheduled Worker and must be rotated in BOTH
places or the cron stops being authorised — see below.

`SHARE_LINK_SECRET` is **not** rotated casually. Rotating it breaks no client
link (the portal resolves links by their stored hash, never by the secret), but
every link minted under the old value can no longer be re-derived, so the next
reminder for each delivery has to replace that delivery's link once, with the
studio's confirmation. Rotate it only if it may have leaked.

If the secret is **missing or shorter than 32 characters**, links still work
(new ones are plain random tokens) but none can be shown again or resent: the
studio's reminder and "Show link" say the server needs configuring, offer no
replacement, and the Worker logs one warning naming `SHARE_LINK_SECRET` (never
a value).

The same secret also keys the **audit fingerprint** of the studio's client
page details (Round C): a change to the phone, WhatsApp, InstaPay or bank
details is audited masked, each value tagged `#` and 8 hex characters of an
HMAC under a key derived from this secret with its own label, so the log shows
WHICH value went in without holding it. Without the secret the audit keeps its
masks with no tag (nothing fails). Rotating the secret changes the tags of new
rows only: compare tags within one secret's lifetime.

### Client links in WhatsApp reminders (owner decision, Round B)

"Open WhatsApp" in the studio's reminder is a one-click `https://wa.me/…?text=`
link whose text **carries the client's portal link**. That link is the client's
only credential for the portal (it does not expire while active). Opening the
wa.me URL is an ordinary HTTPS request outside WhatsApp's end-to-end encryption,
so the portal link also lands in:

- the studio user's **browser history** (and synced history and address-bar
  suggestions, which matters on a shared office computer);
- **wa.me / api.whatsapp.com request logs** at Meta.

The owner accepted this trade-off for the one-click send. **The containment is
"Replace the link"** in the client-link dialog (header menu, Client link): it
kills the old link at once (the portal resolves links by hash) and the next
reminder carries the new one. Replace it when a shared or synced browser
profile, or a lost device, may have exposed it. "Copy message" puts the same
text on the clipboard without going through wa.me.

## Owner task: verify the Resend sending domain

Today every email Metra sends (the digest, follow-ups, the studio's client-act
emails, the client reminders the studio sends) reaches **only the Resend account
owner**: Resend refuses other recipients until the sending domain is verified.
Nothing in Round C waits for this; do it whenever ready.

1. Own a domain for mail. The app still runs on workers.dev, so this domain is
   for sending mail only.
2. In the Resend dashboard: **Domains**, **Add domain**, enter it.
3. At the domain's DNS host, add the records Resend shows: the **TXT (SPF)**
   record and the **DKIM** records.
4. Back in Resend, press **Verify** and wait until it says verified.
5. Point the app at an address on that domain, from `apps/web`:
   `npx wrangler secret put RESEND_FROM` (for example `Metra <hello@your-domain>`).

There is no code change and no PR: `wrangler secret put` itself rolls out a new
Worker version. The next digest or follow-up email then reaches every recipient.

## OPTIONAL owner task: limit the types the `metra-files` bucket stores (Round C, S2)

**Optional. Nothing is waiting for it, and done carelessly it breaks uploads.**

Storage keeps whatever Content-Type the uploading browser declares, and the
bucket has no allow-list today, so a file named `render.pdf` can be stored as
`image/svg+xml` or `text/html`. **The client-facing risk is already closed in
code:** the client page opens a document in the browser only when it is a
pdf/png/jpg/jpeg stored as exactly that type, and saves everything else as an
attachment (`apps/web/src/lib/files/inline-view.ts`); while money is outstanding
the client gets a downscaled image streamed by the app, never a storage link. A
bucket allow-list would only be a second wall.

**Why it can break uploads.** The client and project Documents tabs accept ANY
file type (Word, PowerPoint, ZIP, iPhone photos, videos, ...), and both upload
paths send the browser's own type as is. A browser that cannot type a file (a
DWG on many machines) sends an EMPTY Content-Type. Any type missing from the
list is refused at upload, and the studio sees "something went wrong".

If you do it anyway:

1. First, in the app, upload one file of each kind the studio really uses on the
   client Documents tab, the project Documents tab and a delivery: PDF, PNG, JPG,
   HEIC (iPhone photo), DOCX, XLSX, PPTX, ZIP, MP4, DWG, DXF, and a file with no
   extension. Note the type each upload request sends (browser devtools, Network,
   the PUT to storage, its `content-type` header).
2. Supabase dashboard, Storage, `metra-files`, Edit bucket, Allowed MIME types:
   every type you noted, and at least `application/pdf`, `image/png`,
   `image/jpeg`, `image/webp`, `image/heic`, `image/heif`,
   `application/msword`,
   `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
   `application/vnd.ms-excel`,
   `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
   `application/vnd.ms-powerpoint`,
   `application/vnd.openxmlformats-officedocument.presentationml.presentation`,
   `application/zip`, `application/x-zip-compressed`, `video/mp4`,
   `video/quicktime`, `text/plain`, `text/csv`, `application/acad`,
   `image/vnd.dwg`, `image/x-dwg`, `application/dxf`, `image/vnd.dxf` and
   `application/octet-stream` (most DWG/DXF files; never rendered as a page).
   Leave out every `svg`, `html`, `xhtml` and `xml` type.
3. Save, then repeat step 1 on all three Documents surfaces. If a file with no
   type (empty Content-Type) is now refused, either remove the allow-list again
   or accept that such files cannot be uploaded; do not leave it half-working.

Signed links a paid client opens live 300 seconds, so after a link is replaced
or revoked a document URL minted just before still works for up to five
minutes (accepted, Round C S4).

## Go-live security: what the app does, and the owner steps

The go-live security PR closed these app-side. Nothing here runs by itself:
every owner step below is done by hand, once.

**What the app now does**

- **Sign-in codes are throttled before Supabase is called.** Supabase sees the
  Worker's address, not the visitor's, so its own per-IP limits act as one
  global bucket. Two Workers Rate Limiting bindings are the per-person control
  (`apps/web/src/lib/auth/otp-throttle.ts`, ceilings in `wrangler.jsonc` only):
  `AUTH_OTP_IP_RATE_LIMITER` (namespace 1007, 10 per 60 s per step and caller
  IP, an IPv6 caller by its /64) and `AUTH_OTP_IDENTIFIER_RATE_LIMITER`
  (namespace 1008, 15 per 60 s per step and address; the key is a sha256 prefix,
  never the address). Past either: 429 `otp_rate_limited` with `retry-after: 60`
  (`otp_verify_rate_limited` on a code check: "type the code again", since the
  code held is still good). Send and verify are separate buckets. The
  per-address ceiling stays above the per-IP one, so one source alone cannot
  lock a named address out of sign-in. The address or phone is made canonical
  once (lower-case address; phone as `+` and its digits, dropping only spaces,
  dashes, dots and brackets), and that one string is both the bucket key and
  what Supabase receives. A phone with anything else in it (a letter O for a
  zero, `ext 9`) is refused as `phone_format` and never sent.
  Like every binding it counts per data centre, and a binding **missing** on
  Cloudflare makes sign-in answer 500, by design.
- **Daily email caps per studio** (`apps/web/src/lib/email/daily-caps.ts`,
  owner decision D4): 20 team invite emails and 60 client emails (proposal sends
  plus delivery reminder emails) per rolling 24 hours, counted from rows the app
  already writes. The cap gates the EMAIL: an invite, a resend or a proposal send
  still happens and its link is shown to copy. Only the delivery reminder, where
  the email is the action, refuses with "today's email limit". The cap is a lock:
  a request that cannot take it within the 5 s lock timeout answers "busy, try
  again" and writes and sends nothing. Only a count that fails lets the email go
  (logged).
- **Session cookies** are HttpOnly, SameSite=Lax, Path=/, Secure in production,
  and live **30 days, rolling** (owner decision D2): every token refresh
  rewrites them, so only 30 days without a visit forces a new sign-in.
  `@supabase/ssr` 0.5.2 forces 400 days whatever its options say, so the
  attributes are imposed in our own `setAll`
  (`apps/web/src/lib/supabase/session-cookie.ts`). Existing sessions pick them up
  on their next refresh.
- **The BOQ template** needs `boq_build:create` and leaves the unit cost blank
  for anyone who may not see margin; its cells are formula-guarded.
- **PDF renders cannot reach the network** (only `data:` and `about:` requests).
- **Internal document links** live 300 seconds.
- **Acceptance records** keep the IP Cloudflare saw (`cf-connecting-ip`), never a
  forwarded hop the client wrote.
- **Version preview URLs are off** (`preview_urls: false`); workers.dev stays on,
  it is the production origin.

**Owner steps** (in this order where it matters):

1. **Hyperdrive caching: already off; record only.** Config
   `acc17973ea6847328d6b523bb54953f0` has `caching.disabled: true` (checked Oct
   27 2026). It must stay off: tenant isolation rides on per-transaction
   settings that no cache key can see. If the config is ever re-created:
   `npx wrangler hyperdrive update acc17973ea6847328d6b523bb54953f0 --caching-disabled`.
2. **Bucket size limit** (Supabase SQL editor; safe to run twice):
   ```sql
   update storage.buckets set file_size_limit = 52428800 where id = 'metra-files';
   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'metra-files';
   -- expect: metra-files | false | 52428800 | null
   ```
   Dashboard equivalent: Storage, `metra-files`, Edit bucket, Restrict file
   upload size = 50 MB. Do NOT set `allowed_mime_types` here (see the optional
   task above for why). Until this is done, the Worker logs
   `files bucket has no file size limit` once per isolate on the first upload.
   The limit bounds one object, not one studio: on the Free plan about twenty
   50 MB files fill the whole project.
3. **Supabase Auth rate limits** (Dashboard, Authentication, Rate Limits). First
   read the `ip` column of recent sign-ins in the Auth logs: if a handful of
   Cloudflare addresses carry everyone, Supabase's per-IP buckets are global.
   Then set sign-ups and sign-ins 150 per 5 minutes, token verifications 150 per
   5 minutes, emails sent 100 per hour. That 100 per hour is the cap of
   Supabase's built-in mailer, for the whole project: one source sending codes
   to different addresses can use it up in about ten minutes, and then nobody
   can sign in by email (security test T3). Custom SMTP (Resend) raises it; the
   real fix is Turnstile (step 6), a go-live blocker.
4. **Supabase Auth settings**: email OTP expiry 600 s, OTP length 6, the email
   template sends `{{ .Token }}`, and the phone provider OFF unless SMS is really
   used (otherwise spend caps and geo-permissions limited to Egypt).
5. **After the deploy**: Cloudflare dashboard, Workers, `metra-web`, Settings,
   Domains and Routes: Preview URLs disabled, workers.dev enabled. Then
   Settings, Bindings: `AUTH_OTP_IP_RATE_LIMITER` and
   `AUTH_OTP_IDENTIFIER_RATE_LIMITER` are listed (`wrangler deploy` creates them
   from `wrangler.jsonc`; nothing to create by hand).
6. **Turnstile, once its PR exists, in THIS order: (a) add the widget in the
   Cloudflare dashboard for the Worker's host, mode Managed; (b) add the Actions
   variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; (c) merge and deploy that PR;
   (d) only then, Supabase, Authentication, Attack Protection: enable CAPTCHA,
   provider Turnstile, paste the secret key. Doing (d) before (c) breaks every
   sign-in.**
7. **Supabase Pro before the first paying studio.** On Free, 1 GB of storage and
   5 GB of egress are shared by every studio, and there is no per-studio quota
   yet.
8. **When a custom domain arrives** (its own PR): `workers_dev: false`, update
   `NEXT_PUBLIC_APP_URL` and the cron `APP_ORIGIN`, then the zone's HSTS, Always
   Use HTTPS and minimum TLS 1.2.

## Supabase Free plan: no Storage image transformations

The Supabase org is on the **Free** plan, which has no Storage image
transformations (`render/image`). Until that changes:

- **Unpaid previews and gallery thumbnails show "unavailable".** Both are
  downscaled renditions (`apps/web/src/lib/storage/image-rendition.ts`), Storage
  refuses to make them, and the client page answers "unavailable" instead. Paid
  downloads are not affected. They stay "unavailable" until the plan is
  upgraded: preview copies made in the browser at upload time were **declined
  by the owner (Oct 2026)**. Nothing in code waits for either.
- **The studio logo is served as its original bytes**
  (`apps/web/src/lib/storage/stored-image.ts`, answered by
  `apps/web/src/lib/storage/logo-response.ts`), in Settings and on the client
  page alike: it is not payment-gated, it is a png, jpg or webp of at most 2 MB
  (checked at upload and again when attached), and the page scales it with CSS.
  The app reads at most 2 MB and sends the bytes (an object over that is the
  empty 404, declared length or not); the browser never receives a storage URL.
- **The logo is served again since Round E.** Before it, every logo answered
  the empty 404 in production: the image fetch asked for `redirect: 'error'`,
  which Cloudflare Workers throw on (Node, and so the unit tests, accept it).
  It now asks for `redirect: 'manual'` and refuses any 3xx, so a redirect is
  still never followed. A unit test
  (`apps/web/src/lib/cf/fetch-redirect-mode.test.ts`) refuses `'error'`
  anywhere in Worker source.

## The cron Worker is a separate deployment

`workers/cron` is **not** an npm workspace and is **not** deployed by
`deploy.yml`. It has its own `wrangler.jsonc` and is deployed on its own.

It calls the app through a **service binding** (`APP` -> `metra-web` in its
`wrangler.jsonc`), not over the public URL: Cloudflare refuses a Worker's
`fetch()` to another Worker on the same workers.dev zone and answers **404**
(error 1042). Its **`APP_ORIGIN`** var still builds the request URL and must
point at the live app origin, and its `CRON_SECRET`
must match the one on `metra-web`. Those are two separate Worker configurations
holding one shared value and one pointer between them — if the app moves to a
new domain, or `CRON_SECRET` is rotated on `metra-web` alone, the cron keeps
running and every call it makes is rejected. Nothing in the app surfaces that:
the symptom is automations silently not firing.

### How long one tick may take, and how many orgs fit

| limit | value | source |
|---|---|---|
| one tick, wall clock | **15 minutes** | the cron Worker's Cron Trigger limit. The route runs inside its service-binding call, so this is the ceiling; an HTTP-triggered Worker alone has none while the caller stays connected |
| `maxDuration` | **none** | a route segment option OpenNext on Cloudflare ignores; deliberately not exported by the route |
| open connections per invocation | **6** | Cloudflare; past six, new connections queue until one closes |
| orgs worked on at once | **`ORG_CONCURRENCY` = 3** | `lib/automation/runner.ts`. Each org's cores (`lib/automation/cores.ts`) stay sequential: one DB socket (of the request pool's `max: 5`) plus one outbound call (Supabase auth or Resend) per org, so 3 orgs = 6 connections |
| one recipient lookup / one email | **8 s / 5 s** | `AUTH_LOOKUP_TIMEOUT_MS` / `EMAIL_TIMEOUT_MS` in `lib/http/deadlines.ts`; past that the email counts as failed and the tick moves on. Lookups are memoised per user for the tick. After **5 consecutive failed emails** in one tick the rest of that tick's sends are skipped (counted failed, logged once: `automation emails paused for the rest of this tick`); an org's owner and admin emails go **2 at a time** (`lib/automation/email-breaker.ts`, `email-delivery.ts`) |

**Measured** (Oct 5, `automation_run_log` timestamps): about **5.3 s per org**,
strictly sequential — 6 orgs from 21:01:03 to 21:01:29 UTC. The cost is DB round
trips to eu-west-1, not CPU. So the ceiling per tick is roughly
`15 × 60 × N / 5`: about **180 orgs** sequential (before), about **540 orgs** at
N = 3. The 540 is an estimate that assumes three concurrent orgs each still take
~5 s; confirm it from `automation_run_log` after a deploy.

Orgs run in `id` order, so a tick that is cut off always drops the HIGHEST ids.
The expiry and follow-up cores catch up on the next hourly tick; the digest and
stage reminders are gated to 07:00 Cairo, so an org cut off at that hour misses
that day's (or week's) send.

### The automation cores

Each org runs these in this order on every hourly tick (`lib/automation/cores.ts`).
A core decides for itself whether this is its hour and whether it already ran:
its claim is an `automation_run_log` row `(automation_key, period_key)`, unique
per org, so two overlapping ticks cannot both do the work.

| core | when | claims (`automation_key`: `period_key`) | reaches |
|---|---|---|---|
| `expire` | every tick | `expire`: Cairo day; `expire_nudge`: proposal id | the quotation's sender |
| `followup` | every tick | `followup`: proposal id and ISO week | the quotation's sender |
| `digest` | 07:00 Cairo | `digest`: cadence and day or ISO week | owners and admins |
| `stage` | 07:00 Cairo | `stage`: Cairo day | owners and admins |
| `delivery` (Round C) | 07:00 Cairo, while follow-ups are on | `delivery`: Cairo day; `delivery-followup`: `<delivery id>:<ISO week>` | owners and admins, about deliveries waiting on the client for the follow-up threshold (at most 10 per org per day; every in-flight delivery read, newest first, up to 1,000) |
| `handover` (Round C) | every tick | none: closing is idempotent through the state gate | nobody: it closes design-only deliveries whose handover the client confirmed at least 2 minutes ago (at most 50 per org per tick). The client's own tap already closes inline on their page (C11); this is the safety net for a close that failed. An org with nothing to close costs one read inside its RLS transaction; a workspace whose design flow is off is skipped |
| `notify` (Round C) | every tick, after a probe | `notify`: Cairo hour (`YYYY-MM-DDTHH`), taken only when the probe finds an unanswered act | the studio members a first tap would have notified (the act's roles in the permission matrix), never the client: it repairs a "client responded" notification lost on the client's first tap, for acts 10 minutes to 48 hours old (`app_notify_lost_client_acts`, at most 50 notifier calls per org per hour, run as the org's owner/admin system actor inside its RLS transaction), then emails each member who got a NEW notification, through the tick's email breaker |

No core ever messages a client (owner decision, Oct 9): the `delivery` core
reminds the studio, and the studio sends the client the existing WhatsApp or
email reminder from the delivery page.

The `notify` core is nearly free on an hour with nothing to repair: one probe
statement (any client act in the window that the system actor's own feed does
not answer) rides the `handover` core's transaction, and with no such act the
`notify` core opens no transaction at all. Only when the probe finds one does it
take the hour's claim and call the function, in one transaction; a refusal of
the actor rolls the claim back. Measured on the same 31 ms proxy, 20 orgs, an
hour with nothing lost, 6 alternating ticks each: median 5,127 ms with the core
and its probe, 5,136 ms without, so no measurable cost (the first version, a
transaction per org per tick, cost +3.0 s). An org that does have an act to
repair pays one transaction, about 0.3 to 0.4 s, on that hour only.

**Tick budget for Round C** (plan A14: `durationMs` grows by at most **1.5 s** off
07:00 and **3 s** at 07:00 for today's org count). Measured on a local Postgres
behind a proxy that adds ~31 ms per round trip (a Worker reaching eu-west-1 through
Hyperdrive, modelled), each org with 18 in-flight deliveries and, in the worst
case, 2 client-confirmed handovers to close on that very tick:

| orgs | off 07:00, nothing to close | off 07:00, 2 closes per org | 07:00 Cairo |
|---|---|---|---|
| 1 | +0.20 s | +1.8 s | +2.9 s |
| 20 | +1.41 s | +12.8 s | +20.6 s |
| 100 | +6.8 s | +61.2 s | +98.4 s |

The off-hour cost with nothing to close is within budget at 20 orgs. Each close
is a full executor run (13 statements, ~0.8 s at that round-trip time) and
happens once per delivery in its life, so the "2 closes per org" column is a
burst, not a steady state. The 07:00 delta (about 0.5 s per org for the
follow-ups, 0.5 s for the digest's delivery counts, plus any closes) is over the
plan's 3 s at 20 orgs on this model; the 15-minute ceiling holds with a wide
margin (100 orgs at 07:00: about 170 s; with Resend hanging: 146 s, was 910 s). Read the real
figure from the tick line below at the first 07:00 Cairo after the deploy before
deciding anything; if it must come down, cap the cores, do not lower
`ORG_CONCURRENCY`.

Every tick logs one line, counts only (no ids, no addresses):
`automation tick: orgs= processed= skipped= failed= coreFailures= emailsSent= emailsFailed= durationMs=`.
The route returns the same figures as JSON. Read it with
`npx wrangler tail metra-web`.

## Migrations

Migrations are hand-authored, additive, and applied as ONE transaction by
`npm run db:migrate`. RLS objects never live in one (see *The pre-merge
database step*).

### The two `lock_timeout`s, and which one decides

There are two, on two different connections, and they answer two different
questions. Mixing them up is how the earlier "~8× headroom" in this file got
written.

| setting | where | value | what it bounds |
|---|---|---|---|
| `MIGRATION_LOCK_TIMEOUT` | `packages/db/src/scripts/lock-timeout.ts` | **`3s`** | how long **`db:migrate`, `db:apply-rls` and the fixture purge** will WAIT for a table lock before giving up with 55P03 |
| the app's | `packages/db/src/org-context.ts:47` | `5s` | how long a **request** will wait, per transaction |

`db:migrate` sets its own `lock_timeout = 3 s` **and reads it back from
`pg_settings` before any DDL runs** — Supabase's session pooler discards a
client's startup parameters, so an unverified setting is one that silently did
nothing. A blocked run aborts with 55P03 and rolls the whole batch back.

### The other deadline: `statement_timeout`

`lock_timeout` bounds lock ACQUISITION and nothing else. Once a statement HOLDS
its lock, only `statement_timeout` is left between a stalled scan — or a
half-open pooler socket, which postgres.js has no query-level deadline for — and
a script that waits forever while the schema sits locked.

| script | `statement_timeout` | why that number |
|---|---|---|
| `db:apply-rls` | **`60s`** | catalogue-only DDL; the whole 16-file apply measures ~1 s in CI |
| `db:migrate` | **`120s`** | double, because a migration may SCAN: 0052 runs twelve `VALIDATE CONSTRAINT`s and 0053 ten index builds |

Both are set with `set_config` and **read back from `pg_settings`** on the same
connection, in milliseconds rather than as text — `current_setting` reformats
`'60s'` to `'1min'`, so a text comparison would fail on a value that stuck. A
value that did not stick refuses to run DDL at all.

`statement_timeout` bounds each STATEMENT, not the batch: `db:migrate` runs every
pending file in ONE transaction, so a run may legitimately take longer than 120 s
while no single statement does.

### The migrator's lock window grows with every appended migration

`npm run db:migrate` runs the pending files as ONE transaction. 0049 and 0050
together hold ACCESS EXCLUSIVE on `engagement_events` and
`engagement_transitions` for about five round trips (**~630 ms** from a
workstation). Against the migrator's own 3 s that is a **~4.8× self-abort
margin** — the figure that decides whether `db:migrate` gives up, and the only
one that matters here. The app's 5 s is a different connection and does not
apply. That margin is not a constant: each migration appended to the same pending
batch adds its statements to the same lock window. Two DDL migrations are
comfortable, ten are not. If a batch ever grows past a handful of table-rewriting
statements, run it in smaller batches or in a maintenance window rather than
trusting the margin. Atomicity is the compensation: a 55P03 rolls the whole batch
back, so a failed migrate leaves the previous indexes intact.

### `apply-rls`'s worst case is one file, not the run

Each `rls/*.sql` file goes over the simple query protocol as ONE implicit
transaction, so every ACCESS EXCLUSIVE lock it takes is held until that file
finishes — and `lock_timeout` bounds each lock WAIT, not the file. The biggest
is **`policies/10-catalogue.sql`, which locks 11 distinct tables**, so with a
blocker on every one of them that file can spend **11 × 3 s = 33 s** before
giving up. The realistic case — one long reader on the last table — is ~3 s of
blocked writes on ten tables, then 55P03 and a clean roll-back of *that file*.
Splitting `policies.sql` into six cut this worst case from **46 tables at once to
11**. Every statement under `rls/` is idempotent, so the recovery is to re-run
the command from the top.

CI counts **the batch a single deploy of this ref would apply** and fails above
**`MAX_PENDING_MIGRATIONS = 4`** (`.github/workflows/ci.yml`, step *"Migration
batch size"*, running `scripts/ci/count-pending-migrations.sh`). The count is
written to the run's step summary as `pending migrations: N / 4 (base: ...)`
**either way**, so the number is visible on a green run too, and it needs the
`fetch-depth: 0` on the checkout — a depth-1 clone has no base to count against.
Four DDL migrations in one `db:migrate` transaction is comfortable; ten is not.
If you legitimately need more, split the merge, or raise the constant **in the
same commit that explains why**.

**The base is not one rule, and that was a real hole.** On a push to `main` the
base is `github.event.before`, the previous main tip. It used to be
`git merge-base origin/main HEAD`, which on a main push *is* HEAD — so the count
was always **0** and pushes to `main` were **structurally ungated**: a squash
merge landing four migrations went green by construction. On every other ref the
merge-base with `origin/main` is kept, because the branch delta is what a
reviewer is being asked to approve. A base that is absent, all-zeroes (a
first/force push) or not in the clone falls back to `HEAD~1` with a
`::warning::`; it never aborts the job with a 128.

**What it cannot see:** the target database's `drizzle.__drizzle_migrations`.
Anything already merged but not yet applied by the lead is part of the real
pending batch and is not counted here. Two branches adding four each are both
green, and `main` then holds eight for one `db:migrate`. The pre-merge
`assert-schema-applied` run above is where "pending on THIS database" is
knowable; this gate is the cheap fence that stops one branch proposing ten.

### Recovery: acknowledgements recorded between the 0048 and 0049 deploys

Two migrations, one operator task, and neither backfills — by design.

0048 added `design_engagements.rom_issued_at`, so a band acknowledged before it
sits against a NULL issue date. 0049 added
`engagement_events.acknowledged_issue_at`, so an acknowledgement recorded before
it does not say WHICH issuance it answered. Both read the same way: an
acknowledgement whose issuance is unknown is not evidence that the client saw
the band on the record now. The engagement therefore fails
`rom_not_acknowledged` at the next gate until the band is issued and
acknowledged again.

The portal handles its own half automatically. Because the SDFs compare
`acknowledged_issue_at IS NOT DISTINCT FROM rom_issued_at`, a NULL never matches
a real instant, so the delivery link **re-offers the acknowledge verb** as soon
as the band is issued — the client does not need a new link and the studio does
not need to do anything to make the verb reappear.

Count the acknowledgements that carry no issuance (read-only):

```sql
select count(*) from engagement_events e
where e.acknowledged_issue_at is null
  and e.kind = 'rom_acknowledgement';
```

And the engagements still waiting on an issuance at all (read-only):

```sql
select count(*) from design_engagements de
where exists (
  select 1 from engagement_events e
  where e.engagement_id = de.id and e.kind = 'rom_acknowledgement'
) and de.rom_issued_at is null;
```

And the acknowledgements recorded BETWEEN the 0048 and 0049 deploys — the band
was issued, so `rom_issued_at` is set, but the acknowledgement does not say which
issuance it answered (read-only):

```sql
select count(*) from engagement_events e
join design_engagements de on de.id = e.engagement_id
where e.kind = 'rom_acknowledgement'
  and e.acknowledged_issue_at is null
  and de.rom_issued_at is not null;
```

**That population needs ONE step, not three.**

1. **Ask the client to tap Acknowledge again**, on the delivery link they
   already have.

That is the whole procedure. The portal compares `acknowledged_issue_at IS NOT
DISTINCT FROM rom_issued_at` (`rls/functions/50-delivery-write.sql`, the repeat-suppression branch
of the respond function), and a NULL never matches a real instant — so for an
engagement whose band is already issued, the link is **already re-offering the
acknowledge verb**. Nothing on the studio side has to happen first.

> **An earlier version of this runbook told you to re-set the band first. Do
> not.** "Re-set the band" clears `rom_issued_at` unconditionally, which un-tells
> a client a figure they may be budgeting against — in order to work around a
> `rom_already_issued` refusal (`lib/engagements/rom-issue.ts:44`) that the NULL
> comparison means you never actually hit. The refusal only guards a band that
> IS currently issued and acknowledged against; it is not in the way here.

Re-issuing is needed only for an engagement with **no `rom_issued_at` at all**
(the second count query above) — there is nothing to acknowledge until a band
has been issued. Set the band, issue it, and the client acknowledges from the
same link.

Nothing else clears the flag; there is no backfill script, because stamping a
date onto an old acknowledgement would be inventing evidence on an evidentiary
record.

### After 0050 and 0051: nothing to do

0050 added `engagement_transitions.idempotency_key` and its partial unique
index. Additive and nullable: every existing row keeps a NULL key, and code
deployed before it simply never sends one.

0051 added `variation_order_events.actor_channel` and its CHECK. Additive and
nullable in exactly the same way: rows written before it keep a NULL channel,
and code deployed before it never sends one.

### 0056 and the Round B database step (PR-B9): owner runbook

PR-B9 is a database batch: migration `0056_round_b_client_signals.sql` plus
changed and new functions and one trigger under `rls/`.

**THE ORDER (do not change it):**

1. **You run PR-B9's database step on production FIRST** (steps 1 to 5 below):
   `db:migrate`, then `db:apply-rls`, then the checks.
2. **Only then** does `validate/round-b-combined` merge. It is PR-B9
   (`validate/round-b-db`) and Wave 1 (`validate/round-b-w1`, which contains
   B3) merged into one branch and validated together by CI.
3. PR-B10 to PR-B12 merge after that.

Why, one sentence each:

- **Wave 1 before the database step strands deliveries:** B3's studio card
  treats a client design decision from an EARLIER render round as not
  answering the current one, while the portal's pre-B9 SQL still counts it,
  so the card says "Waiting for the client" and the client has no button
  (only "Client approved offline" gets the delivery out).
- **PR-B9's code before the migration is an outage:** its drizzle schema names
  the two new columns and Drizzle full-row selects list every column, so every
  engagement read fails with 42703 (*Deploying before migrating* above).
- **The database step before any of that code is safe:** the live code never
  names the new columns, and every function it calls keeps its exact argument
  list and return type (pinned by `delivery-portal-round-b.dbtest.ts`); the live
  portal only gains the behaviours listed under *What you will notice*.

**What it changes.** Additive only; no row is updated or backfilled.

| Object | Change |
|---|---|
| `design_engagements.token_nonce` | new nullable `text` column |
| `design_engagements_token_nonce_needs_hash` | CHECK `token_nonce IS NULL OR token_hash IS NOT NULL` |
| `engagement_events.chosen_artifact_id` | new nullable `uuid` column |
| `engagement_events_chosenArtifact_same_org_fk` | FK `(org_id, chosen_artifact_id)` to `engagement_artifacts (org_id, id)`, ON DELETE NO ACTION |
| `engagement_events_chosen_artifact_only_concept` | CHECK `chosen_artifact_id IS NULL OR kind::text = 'concept_approval'` |
| `engagement_events_chosenArtifact_idx` | index on `(org_id, chosen_artifact_id)` |
| `trg_design_engagements_token_nonce` + `clear_token_nonce_on_hash_change()` | NEW BEFORE UPDATE trigger: an update that changes `token_hash` without setting `token_nonce` clears the old nonce, so older code (and a rolled-back Worker) can rotate or revoke without tripping the CHECK |
| `app_delivery_respond_by_token` | same signature; a design decision answers one render issuance (`renders_ready_at`); decisions the studio retracted are ignored; decision verbs take the row lock; an `ok` refreshes `updated_at` |
| `app_delivery_claim_payment_by_token`, `app_delivery_comment_by_token` | same signatures; an `ok` refreshes `updated_at` |
| `app_delivery_by_token` | same signature; per-round design verbs, retracted decisions ignored; new keys `concept_options` (stable positions 1 to 4), `concept_choice_id`, `concept_choice_position` |
| `app_delivery_choose_concept_by_token(text, uuid, text, text, text, text)` | NEW, returns `text` |
| `app_delivery_notify_studio_by_token(text, text, jsonb, jsonb)` | NEW, returns `jsonb`; accepts only the nine client-act message keys and params up to 2048 bytes |
| grants | both new functions: EXECUTE for `metra_app` only, revoked from `public`, `anon`, `authenticated`, `service_role` in the same transaction that creates them (and again in `roles.sql`); `token_nonce` added to the column-level UPDATE grant on `design_engagements` (16 columns) |

**1. Put the PR-B9 code in the production checkout.** The branch is checked
out in another worktree, so detach onto it rather than switching to it. This
PR changes no dependency, so the installed `node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/round-b-combined
git log --oneline -1    # must be the SHA the lead gave you for this run, with green CI
```

**2. Read-only, before** (Supabase SQL editor). Note the three numbers:

```sql
-- (a) migrations recorded so far, and the newest one's stamp
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;

-- (b) how big the tables the migration locks are
select (select count(*) from design_engagements)   as deliveries,
       (select count(*) from engagement_events)    as ledger_rows,
       (select count(*) from engagement_artifacts) as artifacts;

-- (c) deliveries at final_approval whose client decided on an EARLIER render
-- issuance (the studio revised after the decision). After step 3 the portal
-- offers "approve design" to these clients again. Expected: small, often 0.
select count(*) from design_engagements de
where de.state = 'final_approval'
  and de.renders_ready_at is not null
  and exists (
    select 1 from engagement_events e
    where e.engagement_id = de.id and e.actor_channel = 'client'
      and e.kind in ('design_approval', 'design_change_request'))
  and not exists (
    select 1 from engagement_events e
    where e.engagement_id = de.id and e.actor_channel = 'client'
      and e.kind in ('design_approval', 'design_change_request')
      and (e.acknowledged_issue_at is not distinct from de.renders_ready_at
           or (e.acknowledged_issue_at is null
               and e.decided_at >= de.renders_ready_at)));
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

Expected:

- `db:migrate` exits 0. It does not print a count, so re-run query (a) from
  step 2: `migrations` is exactly one higher and `newest` is `1791323400835`
  (0056's journal stamp).
- `db:apply-rls` ends with `apply-rls: verified in the catalogues — 46 tables,
  46 policies, 13 triggers, 35 functions, ...` and `design_engagements update
  narrowed to 16 columns`.
- `assert-schema-applied` exits 0.

If `db:apply-rls` is run BEFORE `db:migrate`, it stops at
`40-delivery-read.sql` with 42703 (that function's SQL body is checked against
the columns when it is created). Nothing is broken: run `db:migrate` and then
`db:apply-rls` again. Every statement in both is re-runnable, and a 55P03 from
either is a lock wait that gave up: re-run at a quieter moment.

**Locks.** `db:migrate` runs 0056 as ONE transaction:

- It holds ACCESS EXCLUSIVE on `design_engagements` and `engagement_events`
  from the first ADD COLUMN until it commits, so reads AND writes of both
  tables wait for the whole batch, not only for the scans.
- Inside that window: one scan of each table for the CHECKs, an FK validation
  over an all-NULL column, and one index build.
- The FK also takes SHARE ROW EXCLUSIVE on `engagement_artifacts`: uploads and
  artifact edits wait, artifact reads continue.
- With the row counts from step 2 (b) in the low thousands this is well under a
  second, comparable to 0049 and 0050's measured ~630 ms, against the
  migrator's 3 s `lock_timeout`. It is an estimate, not a production
  measurement. Delivery pages opened in that window wait; they do not fail.

`db:apply-rls` is the same run as always: the functions replace without table
locks; the new trigger's `drop trigger` and `create trigger` briefly lock
`design_engagements`; the policy files are the 33 s worst case described above.

**4. Read-only, after: expected results.**

```sql
-- 2 rows, both is_nullable = YES
select table_name, column_name, is_nullable from information_schema.columns
where table_schema = 'public' and column_name in ('token_nonce', 'chosen_artifact_id');

-- 3
select count(*) from pg_constraint
where conname in ('engagement_events_chosenArtifact_same_org_fk',
                  'engagement_events_chosen_artifact_only_concept',
                  'design_engagements_token_nonce_needs_hash');

-- 1 row
select indexdef from pg_indexes
where schemaname = 'public' and indexname = 'engagement_events_chosenArtifact_idx';

-- 1 row: trg_design_engagements_token_nonce | design_engagements | t
select t.tgname, c.relname, t.tgenabled <> 'D' as enabled
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where t.tgname = 'trg_design_engagements_token_nonce' and not t.tgisinternal;

-- 6 rows, one per function (no overload was added). The four existing ones
-- show exactly the arguments and results they had before this step:
--   app_delivery_by_token               p_hash text -> jsonb
--   app_delivery_respond_by_token       p_hash, p_action, p_note, p_name, p_ip, p_ua (all text) -> text
--   app_delivery_claim_payment_by_token p_hash, p_milestone_kind, p_note, p_name, p_ip, p_ua (all text) -> text
--   app_delivery_comment_by_token       p_hash text, p_document_id uuid, p_body, p_name, p_ip, p_ua (text) -> text
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_delivery_by_token', 'app_delivery_respond_by_token',
                    'app_delivery_claim_payment_by_token', 'app_delivery_comment_by_token',
                    'app_delivery_choose_concept_by_token',
                    'app_delivery_notify_studio_by_token')
order by 1;

-- 2 rows, each: metra_app = true, public_grants = 0, anon = false,
-- authenticated = false, service_role = false
select f.sig,
       has_function_privilege('metra_app', f.sig, 'execute') as metra_app,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0) as public_grants,
       has_function_privilege('anon', f.sig, 'execute') as anon,
       has_function_privilege('authenticated', f.sig, 'execute') as authenticated,
       has_function_privilege('service_role', f.sig, 'execute') as service_role
from (values
  ('public.app_delivery_choose_concept_by_token(text, uuid, text, text, text, text)'),
  ('public.app_delivery_notify_studio_by_token(text, text, jsonb, jsonb)')
) as f(sig)
join pg_proc p on p.oid = f.sig::regprocedure;

-- true
select has_column_privilege('metra_app', 'public.design_engagements', 'token_nonce', 'UPDATE');

-- 0 and 0: nothing was backfilled
select (select count(*) from design_engagements where token_nonce is not null) as nonces,
       (select count(*) from engagement_events where chosen_artifact_id is not null) as choices;
```

**5. Set `SHARE_LINK_SECRET` on the Worker.** At least 32 random bytes, piped
straight into wrangler, so the value is never printed, never typed and never
in shell history (wrangler deploys from `apps/web`; any checkout works):

```powershell
cd C:\Users\HP\merta-main\apps\web
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | npx wrangler secret put SHARE_LINK_SECRET
npx wrangler secret list    # lists the NAME SHARE_LINK_SECRET, never a value
```

For local development, give the DEV checkout (`C:\Users\HP\merta`, not
`merta-main`) its OWN value in `apps/web/.env.local`, never the production one.
`.env*` is gitignored and must stay uncommitted:

```powershell
cd C:\Users\HP\merta\apps\web
node -e "require('fs').appendFileSync('.env.local', '\nSHARE_LINK_SECRET=' + require('crypto').randomBytes(48).toString('base64url') + '\n')"
```

Nothing reads the secret until PR-B11 is deployed. From then on, a link is
minted as HMAC(secret, engagement id + `token_nonce`), so the studio can send
the client's EXISTING link in a reminder. **If the secret is missing** (never
set, or set on the wrong Worker): every link keeps working, because the portal
resolves links by their stored hash; new links are minted as plain random
tokens with a NULL nonce; and "Show link" and "Send reminder" answer
`delivery_link_unrecoverable` and offer one confirmed replacement, which
without the secret is again not re-derivable. Links minted before PR-B11 have no
nonce whatever you do, so each needs one confirmed replacement the first time
a reminder is sent. **Do not rotate it casually** (see *Rotating a secret*).

**6. Afterwards: merge, in this order, then return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Otherwise tell the lead the step is done. The lead merges
   `validate/round-b-combined` (the order and its reasons are at the top of
   this section). Merging deploys automatically: wait for the Deploy workflow
   to go green before the live checks. PR-B10 to PR-B12 merge after that.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**What you will notice between step 3 and the next deploy.** The deployed app
is unchanged, but the database already behaves the Round B way:

- the client of each delivery counted in step 2 (c) is offered "approve
  design" again on the link they already have, because their decision answered
  an earlier render issuance;
- a client act (approve, request changes, acknowledge, claim a payment,
  comment) now refreshes the delivery's `updated_at`, so the dashboard's
  oldest-first delivery panel ("since it moved") treats that delivery as just
  moved;
- nothing is notified yet: the notifier exists but nothing calls it until
  PR-B10 is deployed.

**Undo, if ever needed.** Undo the CODE, never the database:

1. **Roll the Worker back** with `npx wrangler rollback <version-id>` from
   `apps\web` (see *Rolling back* below). Every Worker version, before or after Round B, works
   on the Round B database: older code never names the new columns, and the
   trigger clears a stale nonce when older code rotates or revokes a link.
2. **Leave the database as it is.** Do NOT run `db:apply-rls` from an older
   `main` while any PR-B9-or-later code is serving: that run re-grants the
   15-column UPDATE list without `token_nonce`, and every revoke (and, after
   PR-B11, every mint and rotate) from the serving code then fails with 42501.
   It is only harmless once the serving Worker is older than PR-B9 again, and
   even then it buys nothing: the old functions it restores would bring back
   the studio and portal disagreement described at the top of this section if
   Wave 1 is still deployed.
3. If the two new functions must go regardless (only after step 1 has put a
   pre-PR-B10 Worker in place, since PR-B10 and PR-B12 call them):
   `drop function public.app_delivery_choose_concept_by_token(text, uuid,
   integer, text, text, text, text); drop function
   public.app_delivery_notify_studio_by_token(text, text, jsonb, jsonb);`. The
   choice function has had seven arguments since 0057 (*0057 and the B12
   database step* below). The columns, constraints, index and trigger stay:
   dropping a column is the one non-additive change this file never makes.

### 0057 and the B12 database step: owner runbook

PR-B12 (the client's concept picker) carries one database step: migration
`0057_concept_letters_and_feed_index.sql` plus changed and new functions under
`rls/`. It is validated on branch `validate/round-b-b12`.

**THE ORDER (do not change it):**

1. **You run the database step on production FIRST**, from the B12 branch
   (steps 1 to 4 below).
2. **Only then** does `validate/round-b-b12` merge (step 5).

Why, one sentence each:

- **B12's code before the migration is an outage:** its drizzle schema names
  the new column `chosen_position`, and Drizzle full-row selects list every
  column, so every engagement read fails with 42703 (*Deploying before
  migrating* above).
- **The database step before the code is safe:** the live code never names
  `chosen_position`, never calls the concept-choice function, and every
  function it does call keeps its exact arguments and result (pinned by
  `delivery-portal-round-b.dbtest.ts`).

**What it changes.** Additive only; no row is updated or backfilled.

| Object | Change |
|---|---|
| `engagement_events.chosen_position` | new nullable `smallint`: the option letter (1 = A) the client saw when choosing |
| `engagement_events_chosen_position_pairs` | CHECK `(chosen_artifact_id IS NULL) = (chosen_position IS NULL)`: a chosen option always has a letter, and a letter always has an option |
| `engagement_events_chosen_position_range` | CHECK `chosen_position IS NULL OR chosen_position BETWEEN 1 AND 4`: the letter is A to D |
| `notifications_org_recipient_created_idx` | index `(org_id, recipient_user_id, created_at DESC)`: the bell and the notifications page read the newest rows without sorting every notification |
| `app_concept_option_positions(uuid)` | NEW, returns `TABLE(artifact_id uuid, option_position integer)`: the one rule that letters options (released, with a file, A to D). SECURITY INVOKER |
| `app_delivery_by_token(text)` | same signature; letters rank released options only; a choice's letter is read from its row; new key `concept_decision` (the client's concept decision on file) |
| `app_delivery_choose_concept_by_token` | the 6-argument version is DROPPED (nothing deployed calls it); NEW 7-argument version `(text, uuid, integer, text, text, text, text)` takes the letter the client saw, returns `text` |
| `app_delivery_notify_studio_by_token(text, text, jsonb, jsonb)` | same signature; one unread notification per payment milestone; also returns the delivery's number, year and titles; a concept choice carries its saved letter |
| `app_delivery_act_notified_by_token(text, text, text)` | NEW, returns `boolean`: "was this client act's notification ever written?" |
| grants | the three new signatures: EXECUTE for `metra_app` only, revoked from `public`, `anon`, `authenticated`, `service_role` in the same transaction that creates them (and again in `roles.sql`) |

**1. Put the B12 code in the production checkout.** Detach onto the branch
(it is checked out in another worktree). This step changes no dependency, so
the installed `node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/round-b-b12
git log --oneline -1    # must be the SHA the lead gave you for this run, with green CI
```

**2. Read-only, before** (Supabase SQL editor). Note the numbers. **Run each
query on its own** (select it, then Run): when a whole block runs at once, the
SQL editor shows only the LAST query's result. The same applies in step 4.

```sql
-- (a) migrations recorded so far, and the newest one's stamp
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;

-- (b) how big the two tables the migration locks are
select (select count(*) from engagement_events) as ledger_rows,
       (select count(*) from notifications)     as notifications;

-- (c) MUST be 0: choices recorded with an option. If it is not 0, STOP and tell the lead.
select count(*) from engagement_events where chosen_artifact_id is not null;

-- (d) 0 rows: the index does not exist yet
select indexname from pg_indexes
where schemaname = 'public' and indexname = 'notifications_org_recipient_created_idx';

-- (e) 1 row: p_hash text, p_artifact_id uuid, p_note text, p_name text, p_ip text, p_ua text
select pg_get_function_identity_arguments(p.oid) from pg_proc p
where p.proname = 'app_delivery_choose_concept_by_token';
```

**Only if (b) `notifications` is above 200,000:** build the index first, as the
ONLY statement in the editor (CONCURRENTLY refuses to run inside a
transaction, and it does not block new notifications while it builds):

```sql
create index concurrently if not exists notifications_org_recipient_created_idx
  on public.notifications (org_id, recipient_user_id, created_at desc);
```

Then check it with the index query in step 4 (expect `t`); the migration's
`IF NOT EXISTS` then skips it. If that query reports `f` (a failed concurrent
build), run `drop index concurrently public.notifications_org_recipient_created_idx;`
and ask the lead before going on.

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

Expected:

- `db:migrate` exits 0. It does not print a count, so re-run query (a) from
  step 2: `migrations` is exactly one higher and `newest` is `1791342035319`
  (0057's journal stamp).
- `db:apply-rls` ends with these two lines (printed from the committed
  `rls/` files, so they are the same on every database; CI's apply-rls step
  verified exactly these counts on this branch, and a production-shaped
  rehearsal printed them verbatim):
  `apply-rls: verified in the catalogues — 46 tables, 46 policies, 13 triggers,
  37 functions, RLS forced on all of them, role metra_app present.` and
  `apply-rls: grants verified — design_engagements update narrowed to 16
  columns with no table-level update, and 5 narrowed table(s) (boqs,
  document_categories, engagement_document_comments, engagement_milestones,
  workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
- `assert-schema-applied` exits 0.

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 23514: check constraint "engagement_events_chosen_position_pairs" of relation "engagement_events" is violated by some row`
  then `Migration failed: STOP, tell the lead (a CHECK refused existing rows; the whole batch rolled back, nothing was changed).`
  This is the case before-check (c) exists for. Do not re-run; tell the lead.
- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  Re-run `db:migrate` a little later. The same two codes from `db:apply-rls`
  print `apply-rls failed: ...` and end `(this file rolled back; the files
  before it stay applied).`: re-run `db:apply-rls`.
- Any other code ends `tell the lead before running anything else`.

If `db:apply-rls` is run BEFORE `db:migrate`, it stops at
`40-delivery-read.sql` (the new function reads `chosen_position`, and a
`language sql` body is checked against the columns when it is created) and
prints `apply-rls failed: SQLSTATE 42703: column e.chosen_position does not exist`
then `apply-rls failed: a column is missing because db:migrate has not run: run db:migrate, then db:apply-rls again; nothing is broken (this file rolled back; the files before it stay applied).`
Do exactly that: both are re-runnable.

**Locks.** `db:migrate` runs 0057 as ONE transaction:

- ACCESS EXCLUSIVE on `engagement_events` from the ADD COLUMN until the commit,
  with one scan of the ledger for each of the two CHECKs inside it: delivery
  pages and studio pages opened in that window wait; they do not fail.
- SHARE on `notifications` for the index build: new notifications and
  mark-as-read wait, the bell still reads.
- Taking the second lock after the first, it can meet an app transaction that
  holds `notifications` and wants `engagement_events`: Postgres then cancels
  one side with 40P01 (deadlock). If it cancels the migration, the batch rolls
  back and the output says to re-run (above).
- With the counts from step 2 (b) this is well under a second against the
  migrator's 3 s `lock_timeout`. It is an estimate, not a production
  measurement.

`db:apply-rls` replaces functions without table locks; the `drop function` of
the 6-argument choice takes a catalogue lock only. The policy files are the
33 s worst case described above.

**4. Read-only, after: expected results.**

```sql
-- 1 row: engagement_events | chosen_position | smallint | YES
select table_name, column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'public' and column_name = 'chosen_position';

-- 2
select count(*) from pg_constraint
where conname in ('engagement_events_chosen_position_pairs',
                  'engagement_events_chosen_position_range');

-- 1 row: t | CREATE INDEX notifications_org_recipient_created_idx ON public.notifications USING btree (org_id, recipient_user_id, created_at DESC)
select i.indisvalid, pg_get_indexdef(i.indexrelid)
from pg_index i join pg_class c on c.oid = i.indexrelid
where c.relname = 'notifications_org_recipient_created_idx';

-- 8 rows, one per function (no extra overload):
--   app_concept_option_positions          p_engagement_id uuid -> TABLE(artifact_id uuid, option_position integer)
--   app_delivery_act_notified_by_token    p_hash text, p_body_key text, p_milestone_kind text -> boolean
--   app_delivery_by_token                 p_hash text -> jsonb
--   app_delivery_choose_concept_by_token  p_hash text, p_artifact_id uuid, p_position integer, p_note text, p_name text, p_ip text, p_ua text -> text
--   app_delivery_claim_payment_by_token   p_hash text, p_milestone_kind text, p_note text, p_name text, p_ip text, p_ua text -> text
--   app_delivery_comment_by_token         p_hash text, p_document_id uuid, p_body text, p_name text, p_ip text, p_ua text -> text
--   app_delivery_notify_studio_by_token   p_hash text, p_body_key text, p_params jsonb, p_roles jsonb -> jsonb
--   app_delivery_respond_by_token         p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text -> text
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_concept_option_positions', 'app_delivery_act_notified_by_token',
                    'app_delivery_by_token', 'app_delivery_choose_concept_by_token',
                    'app_delivery_claim_payment_by_token', 'app_delivery_comment_by_token',
                    'app_delivery_respond_by_token', 'app_delivery_notify_studio_by_token')
order by 1;

-- 3 rows, each: metra_app = true, public_grants = 0, anon = false,
-- authenticated = false, service_role = false
select f.sig,
       has_function_privilege('metra_app', f.sig, 'execute') as metra_app,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0) as public_grants,
       has_function_privilege('anon', f.sig, 'execute') as anon,
       has_function_privilege('authenticated', f.sig, 'execute') as authenticated,
       has_function_privilege('service_role', f.sig, 'execute') as service_role
from (values
  ('public.app_concept_option_positions(uuid)'),
  ('public.app_delivery_act_notified_by_token(text, text, text)'),
  ('public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text)')
) as f(sig)
join pg_proc p on p.oid = f.sig::regprocedure;

-- 0: nothing was backfilled
select count(*) from engagement_events where chosen_position is not null;
```

**5. Afterwards: merge, then return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Otherwise tell the lead the step is done. The lead merges
   `validate/round-b-b12`. Merging deploys automatically: wait for the Deploy
   workflow to go green before the live checks.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**What you will notice between step 3 and the next deploy.** Payment claims on
two different milestones now give two notifications (and two emails) instead of
one row counting both; the bell and the notifications page load faster.
Nothing else changes: no deployed code calls the new or changed concept
functions, and the deployed code ignores the notifier's and the snapshot's new
fields.

**After the B12 deploy, one wording change in old notifications.** A payment
notification written BEFORE 0057 that merged claims on two milestones (count 2
or more) now reads as one claim naming the latest milestone, because B12
removed the "made N payments" sentence (since 0057 each milestone has its own
row). The lead's read-only check on production (Oct 2026) found 0
`client_payment_claimed` notifications, so no existing row is affected.

**Undo, if ever needed.** Undo the CODE, never the database: roll the Worker
back with `npx wrangler rollback <version-id>` from `apps\web` (see *Rolling back*). Every Worker
version runs on the 0057 database: older code never names `chosen_position`
and never calls the concept-choice function. Do NOT run `db:apply-rls` from an
older `main` while B12 code serves: it re-creates the 6-argument choice
function beside the 7-argument one, puts back the old portal letters (ranked
over every option ever recorded) while the choice still checks the new ones,
so a client choosing after the studio hid an option is told the options
changed, and restores the old notifier (claims on different milestones
collapse into one notification again). The column, the two CHECKs and the
index stay: dropping a column is the one non-additive change this file never
makes.

### 0058 and the Round C database step: owner runbook

Round C has ONE database step, and this is it (Wave 1 had none): migration
`0058_client_page_details.sql` plus changed and new functions, one trigger
and new grants under `rls/`. It is validated on branch `validate/round-c-c7`.
The Wave 3 PRs (studio contact and payment details, the client page timeline
and gallery, the inline handover close, the hourly repair of lost
notifications) are cut only after it is merged.

**THE ORDER (do not change it):**

1. **You run the database step on production FIRST**, from the C7 branch
   (steps 1 to 4 below).
2. **Only then** does `validate/round-c-c7` merge (step 5).

Why, one sentence each:

- **C7's code before the migration is an outage:** its drizzle schema names
  seven new `organizations` columns and three new `design_engagements`
  columns, and Drizzle full-row selects list every column, so Settings, the
  dashboard, every delivery page and every client page fail with 42703
  (*Deploying before migrating* above).
- **The database step before the code is safe:** the live code never names the
  new columns, never calls the five new functions, ignores the new fields of
  the client page snapshot, and every function it calls keeps its exact
  arguments and result. Measured on a production-shaped copy: main's own 842
  database tests ran against the 0058 database and 841 passed (the one that
  failed lists every token function by name; this branch adds the two new
  ones), and 15,536 calls of the live functions over two randomly generated
  databases gave identical answers on main and on 0058 except for the one
  intended change below.

**The one thing the live code sees differently.** On a delivery that has ended
(abandoned, closed design-only, or moved to execution) with a milestone still
unpaid, the client page stops offering "I've made this payment". Today it
offers it and then refuses the claim ("this delivery is no longer active"),
so the button only ever led to an error.

**What it changes.** Additive only; no row is updated or backfilled.

| Object | Change |
|---|---|
| `organizations` + 7 columns | `studio_phone`, `studio_whatsapp`, `instapay_address`, `bank_name`, `bank_account_holder`, `bank_account_number`, `bank_iban`: all optional `text`, with 8 CHECKs (numbers are 7 to 15 digits with an optional leading `+`; InstaPay 3 to 100 characters; bank name and holder 2 to 120; InstaPay, bank name and holder need one visible character and may hold no invisible or direction-changing character; account number 4 to 34 letters, digits or `-` with at least one digit; IBAN two capital letters, two digits, then 10 to 30 capitals or digits; an account number or IBAN needs a bank name) |
| `design_engagements` + 3 columns | `client_expected_on` (`date`), `client_expected_state` (the stage it was set in) and `client_expected_set_at` (when), optional, with one CHECK: all three set or all three empty |
| `notifications_org_entity_idx` | NEW index `(org_id, entity_id)` on `notifications`: "was this client act ever notified?" reads one delivery's notifications instead of every recent one of the studio (measured locally: the hourly check over 1,000 deliveries went from 1.3 s to 0.3 s, and from 2.4 s to 0.5 s with no older notifications) |
| `trg_organizations_client_page_writer` | NEW trigger: only an owner or admin of the studio may change the seven columns above; anyone else (including a script or the SQL editor with no app session) gets SQLSTATE MT120 and nothing changes. Every other studio column is unaffected |
| `app_document_media(text)` | NEW, returns `text`: one rule for "is this file an image, a PDF or other", by its extension |
| `app_delivery_by_token(text)` | same signature and result (`jsonb`); new fields: the studio's phone and WhatsApp; the studio's payment details (ONLY while a payment is due on a delivery that is still running, and only when they name InstaPay, an account number or an IBAN); when each pending claim was sent; a dated timeline (stage moves, the client's decisions, payments received; newest 60); the decisions on file (design, handover, budget); the expected date (only while the delivery is still in the stage it was set in, has not moved since, and the date has not passed in Cairo); image/pdf/other per document. Changed: no milestone is claimable on an ended delivery |
| `app_delivery_document_by_token(text, uuid)` | same signature and result; new field `media` |
| `app_delivery_logo_by_token(text)` | NEW, returns `jsonb`: where the studio's logo is stored, for the client page (images only, the delivery's own studio only) |
| `app_delivery_close_target_by_token(text)` | NEW, returns `jsonb`: which delivery a client's handover confirmation closes (only at the handover, only after a live client confirmation) |
| `app_client_act_anchor(uuid, uuid, text, text)` | NEW, internal, returns `timestamptz`: when a client act happened. Executable by NO app role; only the two functions below call it |
| `app_delivery_act_notified_by_token(text, text, text)` | same signature, result and answers; now reads the shared rule above |
| `app_notify_lost_client_acts(timestamptz, timestamptz, jsonb)` | NEW, returns `jsonb`: the hourly repair of a studio notification lost on a client's first tap. Refuses anyone but an owner or admin of the org it runs in; notifies studio members only, never the client; skips an act nobody would hear about |
| grants | the four app-facing new functions and the trigger function: EXECUTE for `metra_app` only, revoked from `public`, `anon`, `authenticated`, `service_role` in the same transaction that creates them (and again in `roles.sql`); `app_client_act_anchor`: revoked from all of those AND `metra_app`; the column-level UPDATE grant on `design_engagements` goes from 16 to 19 columns (the three new ones) |
| `anon`, `authenticated` | lose every grant on every table and sequence in `public`, and the default grants for tables and sequences created later. The app never uses them (it talks to Postgres directly; Supabase serves only Auth and Storage, in their own schemas), so nothing in the app changes; if the Data API is ever switched back on, it reaches nothing here |

**1. Put the C7 code in the production checkout.** Detach onto the branch (it
is checked out in another worktree). This step changes no dependency
(`package.json` and the lockfile are unchanged), so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/round-c-c7
git log --oneline -1    # must be the SHA the lead gave you for this run, with green CI
```

**2. Read-only, before** (Supabase SQL editor). Note the numbers:

```sql
-- (a) migrations recorded so far: expect 58, and newest 1791342035319 (0057)
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;

-- (b) how big the three tables the migration locks are
select (select count(*) from organizations)      as studios,
       (select count(*) from design_engagements) as deliveries,
       (select count(*) from notifications)      as notifications;

-- (c) 0 rows: none of the ten new columns exists yet
select table_name, column_name from information_schema.columns
where table_schema = 'public'
  and column_name in ('studio_phone', 'studio_whatsapp', 'instapay_address', 'bank_name',
                      'bank_account_holder', 'bank_account_number', 'bank_iban',
                      'client_expected_on', 'client_expected_state', 'client_expected_set_at');

-- (d) 9 rows today. Keep this output: step 4 runs it again.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1;

-- (e) 0 rows: none of the new functions exists yet
select proname from pg_proc
where proname in ('app_document_media', 'app_delivery_logo_by_token',
                  'app_delivery_close_target_by_token', 'app_client_act_anchor',
                  'app_notify_lost_client_acts', 'enforce_client_page_details_writer');

-- (f) grants the API roles hold today on public tables and sequences. Note the
-- number (on Supabase it is normally in the hundreds); step 4 expects 0.
select count(*) as api_role_grants
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join lateral aclexplode(c.relacl) a
join pg_roles r on r.oid = a.grantee
where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  and r.rolname in ('anon', 'authenticated');
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

Expected (both commands also print routine NOTICE blocks with a `code:` field,
such as 42P06, 42P07, or "trigger ... does not exist, skipping" on the first
0059 apply-rls; those are normal. Only a line that starts `Migration failed:`
or `apply-rls failed:` is a failure):

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so re-run query (a) from step 2: `migrations` is exactly one higher
  (59) and `newest` is `1791583616467` (0058's journal stamp).
- `db:apply-rls` ends with these two lines (printed from the committed `rls/`
  files, so they are the same on every database; CI's apply-rls step verified
  exactly these counts on this branch, and a production-shaped rehearsal
  printed them verbatim, twice):
  `apply-rls: verified in the catalogues — 46 tables, 46 policies, 14 triggers, 43 functions, RLS forced on all of them, role metra_app present.`
  and
  `apply-rls: grants verified — design_engagements update narrowed to 19 columns with no table-level update, and 5 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
- `assert-schema-applied` exits 0, and its functions line reads
  `assert-schema-applied: functions — 43 declared, all present.` (its index
  and constraint lines are report only and do not fail it).

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  A long query held `organizations`, `design_engagements` or `notifications`
  for more than 3 s. Re-run `db:migrate` a little later. The same two codes
  from `db:apply-rls` print `apply-rls failed: ...` and end `(this file
  rolled back; the files before it stay applied).`: re-run `db:apply-rls`.
- `Migration failed: SQLSTATE 23514: ...` then `Migration failed: STOP, tell the lead (a CHECK refused existing rows; the whole batch rolled back, nothing was changed).`
  This cannot come from the rows you have (all ten columns are new and
  empty); if it appears anyway, do not re-run: tell the lead.
- Any other code ends `tell the lead before running anything else`.

If `db:apply-rls` is run BEFORE `db:migrate`, it stops at
`40-delivery-read.sql` (the snapshot function reads the new studio columns,
and a `language sql` body is checked against the columns when it is created)
and prints
`apply-rls failed: SQLSTATE 42703: column o.studio_phone does not exist`
then
`apply-rls failed: a column is missing because db:migrate has not run: run db:migrate, then db:apply-rls again; nothing is broken (this file rolled back; the files before it stay applied).`
Do exactly that: both are re-runnable. (Rehearsed: this exact output, then
`db:migrate` and `db:apply-rls` green.)

**Locks.** `db:migrate` runs 0058 as ONE transaction:

- ACCESS EXCLUSIVE on `organizations` from its first ADD COLUMN until the
  commit, with one scan of it for each of its eight CHECKs, then ACCESS
  EXCLUSIVE on `design_engagements` with one scan for its CHECK, then SHARE on
  `notifications` while the index builds (new notifications and mark-as-read
  wait; reading the bell does not). Almost every studio page reads
  `organizations`, so every page and every client page opened in that window
  waits; none fails.
- Taking each lock after the previous one, it can meet an app transaction that
  holds a later table and wants an earlier one: Postgres then cancels one side
  with 40P01 (deadlock). If it cancels the migration, the batch rolls back and
  the output says to re-run (above).
- With the counts from step 2 (b) this is well under a second against the
  migrator's 3 s `lock_timeout`. It is an estimate, not a production
  measurement.

`db:apply-rls` replaces functions without table locks; creating the new
trigger takes a brief lock on `organizations`; the policy files are the 33 s
worst case described above.

**4. Read-only, after: expected results.**

```sql
-- 10 rows:
--   design_engagements | client_expected_on     | date                     | YES
--   design_engagements | client_expected_set_at | timestamp with time zone | YES
--   design_engagements | client_expected_state  | USER-DEFINED             | YES
--   organizations      | bank_account_holder    | text                     | YES
--   organizations      | bank_account_number    | text                     | YES
--   organizations      | bank_iban              | text                     | YES
--   organizations      | bank_name              | text                     | YES
--   organizations      | instapay_address       | text                     | YES
--   organizations      | studio_phone           | text                     | YES
--   organizations      | studio_whatsapp        | text                     | YES
select table_name, column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'public'
  and column_name in ('studio_phone', 'studio_whatsapp', 'instapay_address', 'bank_name',
                      'bank_account_holder', 'bank_account_number', 'bank_iban',
                      'client_expected_on', 'client_expected_state', 'client_expected_set_at')
order by 1, 2;

-- 9
select count(*) from pg_constraint
where conname in ('organizations_studio_phone_format', 'organizations_studio_whatsapp_format',
                  'organizations_instapay_address_length', 'organizations_bank_text_length',
                  'organizations_bank_account_number_format', 'organizations_bank_iban_format',
                  'organizations_bank_account_needs_bank', 'organizations_payment_text_printable',
                  'design_engagements_client_expected_together');

-- 1 row: t | CREATE INDEX notifications_org_entity_idx ON public.notifications USING btree (org_id, entity_id)
select i.indisvalid, pg_get_indexdef(i.indexrelid)
from pg_index i join pg_class c on c.oid = i.indexrelid
where c.relname = 'notifications_org_entity_idx';

-- 1 row: trg_organizations_client_page_writer | O
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.organizations'::regclass
  and tgname = 'trg_organizations_client_page_writer';

-- 6 rows, public_grants = 0 and anon = authenticated = service_role = false on every row;
-- metra_app = true on five rows and FALSE on app_client_act_anchor (internal, no app grant)
select f.sig,
       has_function_privilege('metra_app', f.sig, 'execute') as metra_app,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0) as public_grants,
       has_function_privilege('anon', f.sig, 'execute') as anon,
       has_function_privilege('authenticated', f.sig, 'execute') as authenticated,
       has_function_privilege('service_role', f.sig, 'execute') as service_role
from (values
  ('public.app_document_media(text)'),
  ('public.app_delivery_logo_by_token(text)'),
  ('public.app_delivery_close_target_by_token(text)'),
  ('public.app_client_act_anchor(uuid, uuid, text, text)'),
  ('public.app_notify_lost_client_acts(timestamp with time zone, timestamp with time zone, jsonb)'),
  ('public.enforce_client_page_details_writer()')
) as f(sig)
join pg_proc p on p.oid = f.sig::regprocedure;

-- Step 2 (d) again. 11 rows: every row from before is IDENTICAL, and there are
-- exactly two new ones (marked NEW):
--   app_delivery_act_notified_by_token      | p_hash text, p_body_key text, p_milestone_kind text | boolean
--   app_delivery_by_token                   | p_hash text | jsonb
--   app_delivery_choose_concept_by_token    | p_hash text, p_artifact_id uuid, p_position integer, p_note text, p_name text, p_ip text, p_ua text | text
--   app_delivery_claim_payment_by_token     | p_hash text, p_milestone_kind text, p_note text, p_name text, p_ip text, p_ua text | text
--   app_delivery_close_target_by_token      | p_hash text | jsonb   (NEW)
--   app_delivery_comment_by_token           | p_hash text, p_document_id uuid, p_body text, p_name text, p_ip text, p_ua text | text
--   app_delivery_document_by_token          | p_hash text, p_document_id uuid | jsonb
--   app_delivery_document_comments_by_token | p_hash text, p_document_id uuid | jsonb
--   app_delivery_logo_by_token              | p_hash text | jsonb   (NEW)
--   app_delivery_notify_studio_by_token     | p_hash text, p_body_key text, p_params jsonb, p_roles jsonb | jsonb
--   app_delivery_respond_by_token           | p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text | text
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1;

-- 19: the app may update 19 delivery columns (16 before, plus the three new ones)
select count(*) from information_schema.column_privileges
where table_schema = 'public' and table_name = 'design_engagements'
  and grantee = 'metra_app' and privilege_type = 'UPDATE';

-- 0: anon and authenticated hold nothing on any public table or sequence (step 2 (f) again)
select count(*) as api_role_grants
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join lateral aclexplode(c.relacl) a
join pg_roles r on r.oid = a.grantee
where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  and r.rolname in ('anon', 'authenticated');

-- 0: tables and sequences created from now on are not granted to them either
select count(*) as api_role_defaults
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace and n.nspname = 'public'
cross join lateral aclexplode(d.defaclacl) a
join pg_roles r on r.oid = a.grantee
where d.defaclrole = 'postgres'::regrole
  and d.defaclobjtype in ('r', 'S')
  and r.rolname in ('anon', 'authenticated');

-- 0: nothing was backfilled
select (select count(*) from organizations
         where studio_phone is not null or studio_whatsapp is not null
            or instapay_address is not null or bank_name is not null
            or bank_account_number is not null or bank_iban is not null)
     + (select count(*) from design_engagements
         where client_expected_on is not null or client_expected_set_at is not null)
       as touched;
```

**5. Afterwards: merge, then return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Otherwise tell the lead the step is done. The lead merges
   `validate/round-c-c7`. Merging deploys automatically: wait for the Deploy
   workflow to go green.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**What you will notice between step 3 and the C7 deploy.** One thing: on an
ended delivery with a milestone still unpaid, the client page no longer offers
"I've made this payment" (it used to, and the claim was then refused). Nothing
else: no deployed code reads the new snapshot fields, calls the new functions
or names the new columns, the one changed function the live portal calls
(`app_delivery_act_notified_by_token`) gives the same answers, and the
deployed Settings page writes none of the seven studio columns the new
trigger guards.

**What changes at the C7 deploy.** Still nothing you can see: C7 carries the
schema, the functions and their tests, and no screen. The Settings card for
the studio's phone and payment details, the client page timeline, contact
buttons, logo and gallery, the inline handover close and the hourly repair of
lost notifications arrive with the Wave 3 PRs, which are cut after this merge.
When the hourly repair arrives, it tells STUDIO members (the roles the
permission matrix gives each act) about a client act whose notification was
lost; it never messages a client, and it repairs each act once.

**From now on, only an owner or admin changes the studio's phone, WhatsApp or
payment details,** through Settings (Wave 3). Editing those seven columns from
the SQL editor is refused with MT120, because the editor carries no app
session; that is the rule working, not a fault.

**Undo, if ever needed.** Undo the CODE, never the database: roll the Worker
back with `npx wrangler rollback <version-id>` from `apps\web` (see *Rolling back*). Every Worker
version runs on the 0058 database: older code never names the new columns and
never calls the new functions. Do NOT run `db:apply-rls` from an older `main`
while C7-or-later code serves: it restores the older `app_delivery_by_token`
(the client page then loses its timeline, contact and payment details) and
narrows the delivery UPDATE grant back to 16 columns, so saving an expected
date (Wave 3) fails with 42501. `apply-rls` never drops a function or a
trigger, so the new ones stay, and an older `roles.sql` never re-grants
anything to `anon` or `authenticated`. The columns, the CHECKs and the index
stay: dropping a column is the one non-additive change this file never makes.

### 0059 and the Round D database step: owner runbook

Round D has ONE database step, and this is it (Wave 1 had none): migration
`0059_client_page_checks_tightened.sql` plus changed and new functions, one
new trigger and grants under `rls/`. It is validated on branch `validate/round-d-db`. The Wave 3
PR (the client page's consent guard, receipts and the one-tap approve and
budget split) is cut only after this step is done and the branch is merged.

**THE ORDER (do not change it):**

1. **You run the database step on production FIRST**, from the
   `validate/round-d-db` branch (steps 1 to 4 below).
2. **Then** the lead merges `validate/round-d-db` (step 5).
3. **Only then** is the Wave 3 PR cut and merged.

Why, one sentence each:

- **The database step before the code is safe:** it adds no column, the live
  code never calls the new seven-argument respond function, it ignores the new
  fields of the client page snapshot, every function it calls keeps its exact
  arguments and result, and every value the live Settings card saves passes the
  tightened CHECKs (a test saves thousands of generated values through the
  real Settings code against the new CHECKs, with no refusal), and the new
  band trigger changes nothing the live code does (its one band writer
  already clears the issuance stamp). Measured on a fresh database built from
  this branch: main's own 970 database
  tests ran and 966 passed; the four that failed are lists that pin "one
  overload per function" or 0058's loosest phone, which this branch updates,
  not behaviour of the live code.
- **Wave 3 before the database step is an outage:** every review act on the
  client page (approve, ask for changes, confirm the budget) fails with 42883
  (no such function), and the payments card shows no receipts.

**What the live code sees differently between step 3 and Wave 3.** Two small
things, both fixes:

- A client's repeat tap that repairs a lost studio notification no longer
  turns it into "2 times" when the hourly repair already sent it: one act is
  one count, whoever reports it first.
- The client's expected date is compared with stage moves to the
  millisecond, as the studio's card already does, so the two can no longer
  disagree about a move recorded inside the same millisecond.

**What it changes.** No column, no row, no backfill.

| Object | Change |
|---|---|
| `organizations_studio_phone_format` | tightened: `+` and 8 to 15 digits with a country code that does not start with 0, or an Egyptian number with its trunk 0 (`0` then 8 to 10 digits). Was: 7 to 15 digits with an optional `+` |
| `organizations_studio_whatsapp_format` | tightened: the same international form, or an Egyptian mobile `01` + `0`, `1`, `2` or `5` + 8 digits (a landline cannot open WhatsApp) |
| `organizations_payment_text_printable` | tightened: InstaPay, bank name and account holder may also hold no C0 or C1 control character, and may not be made ONLY of these: white space, NEL, the Braille blank, the Hangul fillers, the combining marks of the listed scripts (Latin, Cyrillic, Arabic and the generic combining blocks), the Khmer inherent vowels, the Mongolian and the other variation selectors, the Egyptian hieroglyph mirror, the Khitan filler, private-use characters and noncharacters. A list, not all of Unicode: a lone mark of another script still passes here (the Settings card refuses it) |
| `app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)` | NEW overload, returns `text`: the client's review act names the issuance it saw (the budget band's, or the render round's); a band re-issued or renders re-stamped since the page loaded answers `wrong_state` and saves nothing. The design and budget checks are independent |
| `app_delivery_respond_by_token(text, text, text, text, text, text)` | unchanged; retired from app use by Wave 3 and dropped at the next database step |
| `app_delivery_by_token(text)` | same signature and result (`jsonb`); new fields `rom.issued_at`, `renders_issued_at`, `receipts` (the newest 200 payments of the delivery: kind, amount, date; no method, reference or note) and `receipts_truncated` (true only past 200 payments); the expected date is compared with stage moves to the millisecond |
| `app_delivery_notify_studio_by_token(text, text, jsonb, jsonb)` | same signature and result; a member who already has a notification for this client act (read or not) is not counted twice. Comments are exempt: each comment is a new act |
| `app_notify_lost_client_acts(timestamptz, timestamptz, jsonb)` | same signature and result; it now repairs a lost budget acknowledgement before the design decisions, the order the client page uses, so the two can never wait on each other |
| `trg_design_engagements_rom_issue` + `clear_rom_issue_on_band_change()` | NEW trigger on `design_engagements`, before an update of `rom_low` or `rom_high`: a band change that keeps the old issuance stamp clears it, so a changed band always has to be issued again before the client can confirm it. It never refuses an update; issuing new numbers with a new stamp in one statement is left alone |
| grants | the new overload and the new trigger function: EXECUTE for `metra_app` only, revoked from `public`, `anon`, `authenticated` and `service_role` in the same transaction that creates them (and again in `roles.sql`) |

**Not in this step** (each comes later, in this order):

- U+2028 and U+2029 (line and paragraph separators) in the studio's payment
  text: the Settings card refuses them first (Wave 3), then a CHECK at the
  next database step.
- Phone numbers starting `+200`: see the deviation below.
- The six-argument respond function: EXECUTE is revoked from `metra_app` once
  Wave 3 is past its rollback window, and it is dropped at the next database
  step.

**Deviation from the Round D plan (D2-D1): `+200` numbers still pass.** The
plan's phone and WhatsApp CHECKs refused `+200...` (a +20 number that keeps
its trunk 0). The live Settings card can store such a number: it drops ONE
zero after +20, so "+20 00 10 1234 5678" is saved as `+2001012345678`. A
CHECK that refused it would make that save fail with 23514, and the rule for
this step is that the database is never stricter than the app. So 0059 lets
`+200` through. The app is fixed first (Wave 3 drops the extra zeros); the
CHECK refuses `+200` at a later database step, after counting the stored
`+200` numbers.

**1. Put the Round D database code in the production checkout.** Detach onto
the branch (it is checked out in another worktree). This step changes no
dependency (`package.json` and the lockfile are unchanged), so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/round-d-db
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat aa84dbd HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (aa84dbd)
```

If the diff lists any other file, STOP and tell the lead.

**2. Read-only, before** (Supabase SQL editor). Note the numbers:

```sql
-- 0059 step 2: read-only, before.
-- (a) migrations recorded so far: expect 59, and newest 1791583616467 (0058)
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;

-- (c) 11 rows today, ONE of them app_delivery_respond_by_token. Keep this output: step 4 runs it again.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1, 2;

-- (d) 1 row, NULL: the new overload does not exist yet
select to_regprocedure('public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)') as overload;

-- (e) how many studios have a phone, WhatsApp or payment text set. Note the number; step 4 expects the same.
select count(*) as studios_with_details from organizations
where studio_phone is not null or studio_whatsapp is not null or instapay_address is not null
   or bank_name is not null or bank_account_holder is not null;

-- (f) 0 rows: the new trigger and its function do not exist yet
select tgname as name from pg_trigger where tgname = 'trg_design_engagements_rom_issue'
union all
select proname from pg_proc where proname = 'clear_rom_issue_on_band_change';
```

**(b) THE PRE-CHECK. 0 rows, or STOP.** It lists every studio whose saved
phone, WhatsApp or payment text the tightened CHECKs would refuse, and which
rule (`false` in that column). If it returns ANY row, do not run step 3: the
migration would fail with 23514 and change nothing. Instead, for each studio
listed, the owner or an admin of that studio opens Settings and fixes the field
whose column reads `false` (the Settings card stores the clean form, or says
what is wrong with it). The sheet sends only the boxes that differ from what it
opened with, so retyping the same text in place sends nothing: for a phone or
WhatsApp number, clear it and save, then type it again and save; for a payment
text, delete it and type it again by hand (a value typed by hand carries none
of the hidden characters that made it fail, so it differs and is sent). Then
run this query again until it returns 0 rows. Never fix it in the SQL editor: it is refused there with MT120,
by design, and tell the lead which studios were listed.

```sql
-- 0059 step 2 (b): the studios a tightened CHECK would refuse. Expect 0 rows.
select id, name_en, name_ar, phone_ok, whatsapp_ok, payment_text_ok
from (
  select id, name_en, name_ar,
         coalesce(studio_phone IS NULL OR studio_phone ~ '^\+[1-9][0-9]{7,14}$' OR studio_phone ~ '^0[1-9][0-9]{7,9}$', true) as phone_ok,
         coalesce(studio_whatsapp IS NULL OR studio_whatsapp ~ '^\+[1-9][0-9]{7,14}$' OR studio_whatsapp ~ '^01[0125][0-9]{8}$', true) as whatsapp_ok,
         coalesce((instapay_address IS NULL OR (instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND instapay_address !~ '[\u0001-\u001F\u007F-\u009F]' AND instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_name IS NULL OR (bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_name !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_account_holder IS NULL OR (bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_account_holder !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')), true) as payment_text_ok
  from public.organizations
) checked
where not (phone_ok and whatsapp_ok and payment_text_ok);
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so re-run query (a) from step 2: `migrations` is exactly one higher
  (60) and `newest` is `1791734529315` (0059's journal stamp).
- `db:apply-rls` ends with these two lines (one trigger and one function
  more than after 0058: the band trigger and its function; the new respond
  overload shares its function's name, and the counts are by name. A fresh
  CI-shaped database printed exactly these on this branch, and a
  production-shaped rehearsal printed them verbatim, twice):
  `apply-rls: verified in the catalogues — 46 tables, 46 policies, 15 triggers, 44 functions, RLS forced on all of them, role metra_app present.`
  and
  `apply-rls: grants verified — design_engagements update narrowed to 19 columns with no table-level update, and 5 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
- `assert-schema-applied` exits 0, and its functions line reads
  `assert-schema-applied: functions — 44 declared, all present.` (its index and constraint lines are report only and
  do not fail it).

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  A long query held `organizations` for more than 3 s. Re-run `db:migrate` a
  little later. The same two codes from `db:apply-rls` print `apply-rls
  failed: ...` and end `(this file rolled back; the files before it stay
  applied).`: re-run `db:apply-rls`. (Rehearsed: a reader holding
  `organizations` gave exactly the 55P03 lines, and the migration count did not
  move.)
- `Migration failed: SQLSTATE 23514: ...` then `Migration failed: STOP, tell the lead (a CHECK refused existing rows; the whole batch rolled back, nothing was changed).`
  A studio's saved value breaks a tightened CHECK; every 0058 CHECK is still in
  place. Do not re-run yet: run step 2 (b), fix each studio it lists as it
  says, tell the lead, and only then re-run `db:migrate`. (Rehearsed: one
  planted bad account holder gave exactly these lines, step 2 (b) listed that
  studio, and after it was re-typed the migration ran.)
- Any other code ends `tell the lead before running anything else`.

**Locks.** `db:migrate` runs 0059 as ONE transaction: ACCESS EXCLUSIVE on
`organizations` from the first of its three CHECK swaps until the commit, with
one scan of the table for each new CHECK. Almost every studio page and every
client page reads `organizations`, so pages opened in that window wait; none
fails. At pilot size this is well under the migrator's 3 s `lock_timeout`;
that is an estimate, not a production measurement. `db:apply-rls` replaces
functions without table locks; the policy files are the 33 s worst case
described above.

**4. Read-only, after: expected results.** Run step 2 (b) again first: 0 rows.
Then:

```sql
-- 0059 step 4: read-only, after.
-- 60 and 1791734529315 (0059)
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;

-- 3 rows, tightened = true on every one:
--   organizations_payment_text_printable | t
--   organizations_studio_phone_format    | t
--   organizations_studio_whatsapp_format | t
select conname,
       case conname
         when 'organizations_studio_phone_format'
           then pg_get_constraintdef(oid) like '%[1-9][0-9]{7,14}%' and pg_get_constraintdef(oid) like '%0[1-9][0-9]{7,9}%'
         when 'organizations_studio_whatsapp_format'
           then pg_get_constraintdef(oid) like '%01[0125][0-9]{8}%'
         else pg_get_constraintdef(oid) like '%u2800%'
       end as tightened
from pg_constraint
where conname in ('organizations_studio_phone_format', 'organizations_studio_whatsapp_format',
                  'organizations_payment_text_printable')
order by conname;

-- Step 2 (c) again. 12 rows: every row from before is IDENTICAL, and there is
-- exactly one new one, the second app_delivery_respond_by_token (marked NEW):
--   app_delivery_act_notified_by_token      | p_hash text, p_body_key text, p_milestone_kind text | boolean
--   app_delivery_by_token                   | p_hash text | jsonb
--   app_delivery_choose_concept_by_token    | p_hash text, p_artifact_id uuid, p_position integer, p_note text, p_name text, p_ip text, p_ua text | text
--   app_delivery_claim_payment_by_token     | p_hash text, p_milestone_kind text, p_note text, p_name text, p_ip text, p_ua text | text
--   app_delivery_close_target_by_token      | p_hash text | jsonb
--   app_delivery_comment_by_token           | p_hash text, p_document_id uuid, p_body text, p_name text, p_ip text, p_ua text | text
--   app_delivery_document_by_token          | p_hash text, p_document_id uuid | jsonb
--   app_delivery_document_comments_by_token | p_hash text, p_document_id uuid | jsonb
--   app_delivery_logo_by_token              | p_hash text | jsonb
--   app_delivery_notify_studio_by_token     | p_hash text, p_body_key text, p_params jsonb, p_roles jsonb | jsonb
--   app_delivery_respond_by_token           | p_hash text, p_action text, p_expected_issue_at timestamp with time zone, p_note text, p_name text, p_ip text, p_ua text | text   (NEW)
--   app_delivery_respond_by_token           | p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text | text
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1, 2;

-- 2 rows: metra_app = true, public_grants = 0, anon = authenticated = service_role = false on both
select f.sig, has_function_privilege('metra_app', f.sig, 'execute') as metra_app,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0) as public_grants,
       has_function_privilege('anon', f.sig, 'execute') as anon,
       has_function_privilege('authenticated', f.sig, 'execute') as authenticated,
       has_function_privilege('service_role', f.sig, 'execute') as service_role
from (values ('public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)'),
             ('public.clear_rom_issue_on_band_change()')) as f(sig)
join pg_proc p on p.oid = f.sig::regprocedure;

-- 1 row: O | CREATE TRIGGER trg_design_engagements_rom_issue BEFORE UPDATE OF rom_low, rom_high ON public.design_engagements FOR EACH ROW EXECUTE FUNCTION clear_rom_issue_on_band_change()
select tgenabled, pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid = 'public.design_engagements'::regclass and tgname = 'trg_design_engagements_rom_issue';

-- The same number as step 2 (e): nothing was touched
select count(*) as studios_with_details from organizations
where studio_phone is not null or studio_whatsapp is not null or instapay_address is not null
   or bank_name is not null or bank_account_holder is not null;
```

**5. Afterwards: merge, then return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Otherwise tell the lead the step is done. The lead merges
   `validate/round-d-db`. Merging deploys automatically: wait for the Deploy
   workflow to go green. The merge carries no screen change (the schema
   description, the database tests and this runbook); the Wave 3 PR is cut
   after it.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.** Undo the CODE, never the database: roll the Worker
back with `npx wrangler rollback <version-id>` from `apps\web` (see *Rolling back*). Every Worker
version runs on the 0059 database, because the six-argument respond function
stays (until 0060, which drops it). Do NOT run `db:apply-rls` from a `main` older than this branch once
Wave 3 serves: it restores the older `app_delivery_by_token` without the
issuance instants and receipts, so every design approval and budget
confirmation on the client page answers "this changed, please look again" and
the receipts disappear. `apply-rls` never drops a function or a trigger, so
the new overload and the band trigger stay either way; every older Worker
works with the trigger, because the app's band writer already clears the
stamp itself.

**Only if a legitimate studio value is refused** by a tightened CHECK (the
Settings card then says "something went wrong" on save; the lead confirms it
from the Worker logs as 23514), put the three 0058 CHECKs back with this ONE
statement (atomic on its own; it touches no row, and every value saved under
0059 also passes 0058), then tell the lead:

```sql
-- 0059 undo: the three 0058 CHECKs back, as ONE statement.
alter table public.organizations
  drop constraint if exists organizations_studio_phone_format,
  drop constraint if exists organizations_studio_whatsapp_format,
  drop constraint if exists organizations_payment_text_printable,
  add constraint organizations_studio_phone_format
    check (studio_phone IS NULL OR studio_phone ~ '^\+?[0-9]{7,15}$'),
  add constraint organizations_studio_whatsapp_format
    check (studio_whatsapp IS NULL OR studio_whatsapp ~ '^\+?[0-9]{7,15}$'),
  add constraint organizations_payment_text_printable
    check ((instapay_address IS NULL OR (instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]' AND instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]')) AND (bank_name IS NULL OR (bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]' AND bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]')) AND (bank_account_holder IS NULL OR (bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]' AND bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]')));
```

### Round D Wave 3 (the client page's consent guard): the deploy and its smoke test

Wave 3 is app code only: no migration, no `apply-rls`. It is the code the 0059
step above was for, so it merges ONLY after that step's step 4 matched and
`validate/round-d-db` is on `main`. Merged before it, every review act on the
client page fails with 42883 and the receipts disappear (see THE ORDER above).

**What changes on the client page.**

- Every design decision and every budget confirmation names the issuance the
  client's page showed (the render round, the budget band). The database
  refuses one whose issuance is no longer on file ("this changed, please look
  again") and saves nothing. No check runs in the app before the write any more.
- Approve the design together with the budget is two consents, each judged on
  its own issuance (owner decision): a band re-issued after the page loaded
  saves the design approval and tells the client their budget confirmation
  was not recorded; new renders with the same band save the budget
  confirmation alone and ask for the design again; both changed saves neither.
  Each line the client reads about the budget talks about the budget only.
- A render the studio shows the client while the client has NOT yet answered
  the final design (at the final approval, or during an as-built triage)
  starts a new round: an approval taken on the page from before it is
  refused. Once the client has approved (or asked for changes), a render shown
  later leaves that decision standing (owner decision).
- The payments card lists the payments received from their own list (up to
  200, with a note when there are more), not from the dated timeline.
- Settings: "+20 00 10 ..." is saved as `+2010...` (every extra trunk zero
  dropped), and a line or paragraph separator inside InstaPay, the bank name or
  the account holder is refused.

**What the studio sees.** When the design is approved but the client's budget
confirmation was refused because the band changed after their page loaded,
the design notification (bell and email) adds that the client has not
acknowledged the budget range yet. The cockpit's "Budget range acknowledged"
guard stays open until the client confirms it.

**Smoke test, right after the Deploy workflow is green (owner, 5 minutes).**
This run is ALSO the only proof that an issuance instant crosses Cloudflare's
Hyperdrive with its microseconds intact: the tests prove the app, drizzle and
Postgres, not the Hyperdrive hop. Use one of the studio's own TEST deliveries,
never a client's:

1. In the cockpit, take the test delivery to the final approval with renders
   shared, and issue a budget range.
2. Open its client link in a private window, freshly loaded. The design card
   offers Approve, and its confirmation says it also confirms the budget range.
3. Approve. Expected on the client page: "Design approved" and "You also
   confirmed seeing the budget range." Expected in the cockpit: the design
   approved AND "Budget range acknowledged" ticked, and the bell shows the
   approval without a budget sentence.
4. While it runs, watch the logs from `apps/web`:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

**Reading the result.** Production runs on the Workers Free plan, so a request
can now and then stop with "exceeded CPU" (error 1102) or a "something went
wrong" page. That is a RETRY, not a failure: reload the page and approve again
(a repeat tap is safe; it never records twice).

**Roll back only on one of these three:**

- a `42883` in the log (the database step is missing: the code calls a
  function that does not exist);
- step 3 answers "this changed, please look again" on a page you loaded fresh
  in step 2 (the instant did not survive the trip: every act on every client
  page would answer the same);
- a log line starting `approve design with budget:`.

Then roll the Worker back at once and tell the lead what you saw. Leave the
database alone. Rolling back to any version below this deploy is safe on the
0059 database (until 0060): the six-argument respond function the older code
calls stays until the next database step. Once 0060 has run, this deploy is
the oldest version a rollback may pick (*0060 and the Round E database step*).
Pick the version by its id (see *Rolling back*):

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler deployments list
npx wrangler rollback <version-id>
```

**Before the next database step (read-only, owner).** The CHECK that refuses
`+200` numbers waits for this count. Anything above 0 is a studio number saved
before Wave 3. To fix one, the studio's owner or an admin opens Settings,
CLEARS the number and saves, then types it again and saves. (Saving without a
change sends nothing: the sheet sends only the boxes that differ from what it
opened with, and typing the same digits back is no difference.)

```sql
select count(*) as plus_200_numbers
  from public.organizations
 where studio_phone ~ '^\+200' or studio_whatsapp ~ '^\+200';
```

### 0060 and the Round E database step: owner runbook

Round E has ONE database step, and this is it (Wave 1 had none): migration
`0060_client_page_checks_round_e.sql` plus changed functions and grants under
`rls/`, and ONE function DROPPED. It is validated on branch
`validate/round-e-db`.

**THE ORDER (do not change it):**

0. **The app goes first.** Round E Wave 1 and `validate/round-e-db` are merged
   to `main` and deployed (the Deploy workflow green). This is safe: the
   branch's app-side changes are tests and comments only, and no Worker code
   in it needs 0060. You then confirm, in step 2 (f), that the live Worker is
   that deploy, which is above the rollback floor.
1. **Then you run the database step on production**, from the
   `validate/round-e-db` branch (steps 1 to 4 below). The lead keeps that
   branch until step 5 is done.
2. **Then** you smoke-test and tell the lead (step 5).

**FROM STEP 3 ON, NO WORKER VERSION OLDER THAN THE ROUND D WAVE 3 DEPLOY MAY
EVER SERVE AGAIN.** Such a version calls the six-argument respond function
this step drops, so every review act on the client page (approve, ask for
changes, confirm the budget) would fail with 42883 (no such function). Step 2
(f) writes down the versions `wrangler rollback` may still pick.

Why this order is safe, one sentence each:

- **The app before the database is safe:** the merged code changes no Worker
  behaviour; it carries this step's database files, its tests and comments.
- **The dropped function has no caller:** every Worker version since Round D
  Wave 3 calls only the seven-argument respond function
  (`respond-arity.test.ts` refuses any other form in the app's source).
- **The CHECKs are looser than the live app:** since Wave 3 the Settings card
  drops every trunk 0 after +20 and refuses a line or paragraph separator
  anywhere, and it already treated U+1D159 as blank; a test saves thousands of
  generated values through the real Settings code against the new CHECKs,
  with no refusal. A read-only count on Oct 12 2026 found no stored `+200`
  number and no payment text holding U+2028, U+2029 or U+1D159.
- **The four timed functions keep their signatures,** so their grants are kept
  and every caller is unchanged.
- **Measured** on a fresh database built from this branch: main `43f06c4`'s
  own 1041 database tests (with its own `packages/db`) ran and 1024 passed.
  The 17 that failed are pins this branch updates (the dropped function's
  rows and calls, the new `lock_timeout` setting, and `+200` numbers that 0059
  still kept), not behaviour of the live code. One of them,
  `delivery-db-step-0058-api-roles`, replays `43f06c4`'s `roles.sql` on its own,
  which names the dropped function and so fails on 0060.

**What it changes.** No column, no row, no backfill.

| Object | Change |
|---|---|
| `organizations_studio_phone_format` | an international number may no longer start `+200` (Egypt's code with its trunk 0 kept). Everything else as 0059 |
| `organizations_studio_whatsapp_format` | the same `+200` rule. Everything else as 0059 |
| `organizations_payment_text_printable` | InstaPay, bank name and account holder may no longer hold U+2028 or U+2029 (line and paragraph separators) anywhere, and a value made ONLY of U+1D159 (the musical null notehead) and the other invisible characters 0059 lists is refused. "CIB" followed by U+1D159 is kept, as the app keeps it. The same whole-value rule covers the unassigned default-ignorable code points (U+FFF0 to U+FFF8, U+E0000, U+E0002 to U+E001F, U+E0080 to U+E00FF, U+E01F0 to U+E0FFF), which the app already refuses as a whole value |
| `app_delivery_respond_by_token(text, text, text, text, text, text)` | DROPPED. Retired from app use since Round D Wave 3 |
| `app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)` | same signature, result and grants; waits at most 4 s for the delivery row (`lock_timeout`), then fails with 55P03 and saves nothing |
| `app_delivery_claim_payment_by_token(text, text, text, text, text, text)` | the same 4 s `lock_timeout`; nothing else |
| `app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text)` | the same 4 s `lock_timeout`; nothing else |
| `app_delivery_comment_by_token(text, uuid, text, text, text, text)` | the same 4 s `lock_timeout`; nothing else |
| `rls/roles.sql` | the dropped function's grant, revoke and API-role revoke lines removed |
| `app_current_user_orgs()`, `app_claim_invitation(uuid)` | same signatures, results and grants; every `db:apply-rls` drops and re-creates them (a return type change), and they are now locked down in the same transaction, not only files later in `roles.sql` |
| `policies/40-engagements.sql` | same policies and trigger; `design_engagements` is now the LAST table the file touches |

Why 4 s: the client page's one-tap "approve the design and confirm the budget"
is two of these calls, and 2 x 4 s stays under the app's 15 s database
deadline. So a tap that waits on a long studio transaction is refused and
rolled back BEFORE the app gives up on it: the client reads "try again" and
nothing was saved, never "try again" about a write that later commits.

**1. Put the Round E database code in the production checkout.** Detach onto
the branch (it is checked out in another worktree). This step changes no
dependency (`package.json` and the lockfile are unchanged), so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/round-e-db
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat dc6e381 HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (dc6e381)
```

If the diff lists any other file, STOP and tell the lead.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the
LAST result of what you run, so run each block below ON ITS OWN: paste it,
run it, note the result, then the next one.

(a) How many migrations are recorded. Expect `migrations` 60 and `newest`
1791734529315 (0059's journal stamp).

```sql
-- 0060 step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. 0 rows, or STOP.** It lists every studio whose saved
phone, WhatsApp or payment text a new CHECK would refuse, and which rule
(`false` in that column). If it returns ANY row, do not run step 3: the
migration would fail with 23514 and change nothing. Instead, for each studio
listed, the owner or an admin of that studio opens Settings and fixes the field
whose column reads `false` (the Settings card stores the clean form, or says
what is wrong with it). The sheet sends only the boxes that differ from what it
opened with, so retyping the same text in place sends nothing: for a phone or
WhatsApp number, clear it and save, then type it again and save; for a payment
text, delete it and type it again by hand (a value typed by hand carries none
of the hidden characters that made it fail, so it differs and is sent). Then
run this query again until it returns 0 rows. Never fix it in the SQL editor:
it is refused there with MT120, by design. Tell the lead which studios were
listed.

```sql
-- 0060 step 2 (b): the studios a new CHECK would refuse. Expect 0 rows.
select id, name_en, name_ar, phone_ok, whatsapp_ok, payment_text_ok
from (
  select id, name_en, name_ar,
         coalesce(studio_phone IS NULL OR (studio_phone ~ '^\+[1-9][0-9]{7,14}$' AND studio_phone !~ '^\+200') OR studio_phone ~ '^0[1-9][0-9]{7,9}$', true) as phone_ok,
         coalesce(studio_whatsapp IS NULL OR (studio_whatsapp ~ '^\+[1-9][0-9]{7,14}$' AND studio_whatsapp !~ '^\+200') OR studio_whatsapp ~ '^01[0125][0-9]{8}$', true) as whatsapp_ok,
         coalesce((instapay_address IS NULL OR (instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND instapay_address !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' AND instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\U0001D159\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF\uFFF0-\uFFF8\U000E0000\U000E0002-\U000E001F\U000E0080-\U000E00FF\U000E01F0-\U000E0FFF]')) AND (bank_name IS NULL OR (bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_name !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' AND bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\U0001D159\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF\uFFF0-\uFFF8\U000E0000\U000E0002-\U000E001F\U000E0080-\U000E00FF\U000E01F0-\U000E0FFF]')) AND (bank_account_holder IS NULL OR (bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_account_holder !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' AND bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\U0001D159\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF\uFFF0-\uFFF8\U000E0000\U000E0002-\U000E001F\U000E0080-\U000E00FF\U000E01F0-\U000E0FFF]')), true) as payment_text_ok
  from public.organizations
) checked
where not (phone_ok and whatsapp_ok and payment_text_ok);
```

(c) The client page functions. 12 rows today, TWO of them
`app_delivery_respond_by_token` (the six-argument one is the row this step
drops). Keep this output: step 4 (c) runs it again.

```sql
-- 0060 step 2 (c): the client page functions. Run this one alone.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'app_delivery_%'
order by 1, 2;
```

Expected (`proname | args | result`):

```text
app_delivery_act_notified_by_token      | p_hash text, p_body_key text, p_milestone_kind text | boolean
app_delivery_by_token                   | p_hash text | jsonb
app_delivery_choose_concept_by_token    | p_hash text, p_artifact_id uuid, p_position integer, p_note text, p_name text, p_ip text, p_ua text | text
app_delivery_claim_payment_by_token     | p_hash text, p_milestone_kind text, p_note text, p_name text, p_ip text, p_ua text | text
app_delivery_close_target_by_token      | p_hash text | jsonb
app_delivery_comment_by_token           | p_hash text, p_document_id uuid, p_body text, p_name text, p_ip text, p_ua text | text
app_delivery_document_by_token          | p_hash text, p_document_id uuid | jsonb
app_delivery_document_comments_by_token | p_hash text, p_document_id uuid | jsonb
app_delivery_logo_by_token              | p_hash text | jsonb
app_delivery_notify_studio_by_token     | p_hash text, p_body_key text, p_params jsonb, p_roles jsonb | jsonb
app_delivery_respond_by_token           | p_hash text, p_action text, p_expected_issue_at timestamp with time zone, p_note text, p_name text, p_ip text, p_ua text | text
app_delivery_respond_by_token           | p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text | text   (DROPPED in step 3)
```

(d) The four writes step 3 gives a `lock_timeout`. 4 rows, in this order
(`choose_concept`, `claim_payment`, `comment`, `respond`), and `config` holds
ONE setting on each: `search_path=""`.

```sql
-- 0060 step 2 (d): the settings of the four timed writes. Run this one alone.
select f.sig, p.proconfig as config
from (values ('public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)'),
             ('public.app_delivery_claim_payment_by_token(text, text, text, text, text, text)'),
             ('public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text)'),
             ('public.app_delivery_comment_by_token(text, uuid, text, text, text, text)')) as f(sig)
join pg_proc p on p.oid = f.sig::regprocedure
order by 1;
```

(e) How many studios have a phone, WhatsApp or payment text set. Note the
number; step 4 expects the same.

```sql
-- 0060 step 2 (e): studios with client page details. Run this one alone.
select count(*) as studios_with_details from organizations
where studio_phone is not null or studio_whatsapp is not null or instapay_address is not null
   or bank_name is not null or bank_account_holder is not null;
```

(f) **THE ROLLBACK FLOOR.** In PowerShell, list the Worker's deployments:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler deployments list
cd C:\Users\HP\merta-main
```

The dates in the list are UTC (Cairo is UTC+3). Each version id is printed
after `(100%)` under `Version(s):`.

**THE FLOOR is version `85fe5e0b-b59f-4a2b-bc4a-0dcbe6078627`**, the Round D
Wave 3 deploy of main `43f06c4`, created `2026-10-12T00:35` UTC. It and every
version created after it may serve; nothing older may, ever again, once step 3
runs. The Round E app deploy (THE ORDER, 0) is later still and is the newest
line: write down its version id too. **From step 3 on, `npx wrangler rollback
<version-id>` may only ever be given one of these ids, and never run without
one** (see *Rolling back*). If the newest deploy is not the Round E app deploy,
STOP: the app goes first.

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** `db:apply-rls` also prints routine NOTICE
blocks (several lines each, with `severity: 'NOTICE'` and a `message:` line).
They are not failures. The production-shaped rehearsal printed these
`message:` lines (on Supabase a line about a role may differ; any line that
ends `does not exist, skipping` or `already exists, skipping` is the same
kind):

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`:
  `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`.
  If you ever run `db:apply-rls` a second time, it adds one more first:
  `message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`
  (the drop has nothing left to drop).

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure. Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (61).
- `db:apply-rls` exits 0 and ends with the same two lines as after 0059 (the
  dropped function shares its name with the one that stays, and the counts
  are by name). The first starts `apply-rls: verified in the catalogues` and
  goes on `46 tables, 46 policies, 15 triggers, 44 functions, RLS forced on
  all of them, role metra_app present.`; the second starts
  `apply-rls: grants verified` and goes on `design_engagements update narrowed to 19 columns with no table-level update, and 5 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
  A production-shaped rehearsal (main `43f06c4`'s own migrate and apply-rls
  on a database with the Supabase API roles and their default EXECUTE, then
  this branch) printed exactly these, twice.
- `assert-schema-applied` exits 0, and its functions line starts
  `assert-schema-applied: functions` and ends `44 declared, all present.` (its
  index and constraint lines are report only and do not fail it).

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  A long query held `organizations` for more than 3 s. Re-run `db:migrate` a
  little later. The same two codes from `db:apply-rls` print `apply-rls
  failed: ...` and end `(this file rolled back; the files before it stay
  applied).`: re-run `db:apply-rls`. (Rehearsed: a reader holding `organizations` gave
  exactly the 55P03 lines, and the migration count stayed 60.)
- `Migration failed: SQLSTATE 23514: ...` then `Migration failed: STOP, tell the lead (a CHECK refused existing rows; the whole batch rolled back, nothing was changed).`
  A studio's saved value breaks a new CHECK; every 0059 CHECK is still in
  place. Do not re-run yet: run step 2 (b), fix each studio it lists as it
  says, tell the lead, and only then re-run `db:migrate`. (Rehearsed: one planted
  `+2001012345678` gave exactly these lines, naming
  `organizations_studio_phone_format`; step 2 (b) listed that studio with
  `phone_ok` false; after the number was saved again the migration ran.)
- Any other code ends `tell the lead before running anything else`.

**55P03 on the client page WHILE step 3 runs is the step itself.** From the
moment `db:apply-rls` gives the four client writes their 4 s `lock_timeout`, a
client tap that queues behind one of the step's own locks for more than 4 s is
refused with 55P03 and saves nothing (the client reads "try again"). That is
not a reason to undo anything: a retry after the step has finished succeeds.
Undo (2) is only for 55P03 lines that keep coming AFTER step 3 is done.

**Locks.** `db:migrate` runs 0060 as ONE transaction: ACCESS EXCLUSIVE on
`organizations` from the first of its three CHECK swaps until the commit, with
one scan of the table for each new CHECK. Almost every studio page and every
client page reads `organizations`, so pages opened in that window wait; none
fails. At pilot size this is well under the migrator's 3 s `lock_timeout`;
that is an estimate, not a production measurement. `db:apply-rls` replaces
and drops functions without table locks; the policy files are the 33 s worst
case described above. `policies/40-engagements.sql` now touches
`design_engagements` LAST, so that table is never held while the file waits
on another one (measured with a 2.5 s reader on another engagement table: held
about 2,440 ms before this change, 3 to 16 ms after).

**4. Read-only, after: expected results.** Again each block ON ITS OWN. First
run step 2 (b) again: 0 rows.

(a) `migrations` 61 and `newest` 1791767848859 (0060's journal stamp).

```sql
-- 0060 step 4 (a): migrations recorded now. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) 3 rows, `tightened` true on every one:
`organizations_payment_text_printable`, `organizations_studio_phone_format`,
`organizations_studio_whatsapp_format`. (Before step 3, and after undo (3),
all three read false.)

```sql
-- 0060 step 4 (b): the three new CHECKs. Run this one alone.
select conname,
       case conname
         when 'organizations_payment_text_printable'
           then strpos(pg_get_constraintdef(oid), '\u009F\u2028\u2029]') > 0
            and strpos(pg_get_constraintdef(oid), '\uFFA0\U0001D159') > 0
         else strpos(pg_get_constraintdef(oid), '!~ ''^\+200''') > 0
       end as tightened
from pg_constraint
where conname in ('organizations_studio_phone_format', 'organizations_studio_whatsapp_format',
                  'organizations_payment_text_printable')
order by conname;
```

(c) Step 2 (c) again, as its own block. 11 rows: every row from before is
IDENTICAL except that the LAST one (the six-argument
`app_delivery_respond_by_token`) is gone. Exactly one
`app_delivery_respond_by_token` row is left, the one with
`p_expected_issue_at`.

(d) NULL: the six-argument respond function is gone.

```sql
-- 0060 step 4 (d): the dropped function. Run this one alone.
select to_regprocedure('public.app_delivery_respond_by_token(text, text, text, text, text, text)') as dropped;
```

(e) Step 2 (d) again, as its own block. The same 4 rows, and `config` now
holds TWO settings on each: `search_path=""` and `lock_timeout=4s`.

(f) 1 row: `metra_app` true, `public_grants` 0, `anon`, `authenticated` and
`service_role` false.

```sql
-- 0060 step 4 (f): who may run the respond write. Run this one alone.
select has_function_privilege('metra_app', p.oid, 'execute') as metra_app,
       (select count(*) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where a.grantee = 0) as public_grants,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute') as service_role
from pg_proc p
where p.oid = 'public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)'::regprocedure;
```

(g) Step 2 (e) again: the same number. Nothing was touched.

**5. Afterwards: smoke test, then return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Smoke test on one of the studio's own TEST deliveries, never a client's,
   with the log open (from `C:\Users\HP\merta-main\apps\web`:
   `npx wrangler tail metra-web`):
   - approve the design with the budget, as steps 1 to 3 of the *Round D
     Wave 3* smoke test;
   - write one comment on a shared document from the client link.

   Expected: both are saved, and the log shows no `42883` and no `55P03`. An
   "exceeded CPU" page (error 1102) is a retry, not a failure (see *Round D
   Wave 3*).
3. Tell the lead the step is done. The branch is already merged and deployed
   (THE ORDER, 0); nothing is merged now.
4. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.** There is no undo that brings the six-argument
function back: no Worker allowed to serve calls it. Never run `db:apply-rls`
from a tree older than this branch.

**(1) The code.** From `C:\Users\HP\merta-main\apps\web`, run
`npx wrangler rollback <version-id>` with an id you wrote down in step 2 (f):
the floor `85fe5e0b-b59f-4a2b-bc4a-0dcbe6078627` or a later one. **Never run it
without an id:** it then picks the deployment before the current one, which
may be below the floor. **A version older than the floor answers 42883 on
every review act on the 0060 database.**

**(2) Only the `lock_timeout`s** (the log shows client taps failing with
`55P03` because a studio transaction is legitimately long, AFTER step 3 is
done; for 55P03 while step 3 runs, see step 3). Run this ONE
block; each function keeps its grants. A later `db:apply-rls` from this
branch or a newer `main` puts the four back. Rehearsed: step 2 (d) then
shows `search_path=""` alone on all four.

```sql
-- 0060 undo (2): the four lock_timeouts off.
alter function public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text) reset lock_timeout;
alter function public.app_delivery_claim_payment_by_token(text, text, text, text, text, text) reset lock_timeout;
alter function public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text) reset lock_timeout;
alter function public.app_delivery_comment_by_token(text, uuid, text, text, text, text) reset lock_timeout;
```

**(3) The CHECKs,** only if a legitimate studio value is refused by a new
CHECK (the Settings card then says "something went wrong" on save; the lead
confirms it from the Worker logs as 23514). This ONE statement puts the three
0059 CHECKs back (atomic on its own; it touches no row, and every value saved
under 0060 also passes 0059). Then tell the lead. Rehearsed: step 4 (b)
then reads false on all three, and the 0060 file run again brings them back.

```sql
-- 0060 undo (3): the three 0059 CHECKs back, as ONE statement.
alter table public.organizations
  drop constraint if exists organizations_studio_phone_format,
  drop constraint if exists organizations_studio_whatsapp_format,
  drop constraint if exists organizations_payment_text_printable,
  add constraint organizations_studio_phone_format
    check (studio_phone IS NULL OR studio_phone ~ '^\+[1-9][0-9]{7,14}$' OR studio_phone ~ '^0[1-9][0-9]{7,9}$'),
  add constraint organizations_studio_whatsapp_format
    check (studio_whatsapp IS NULL OR studio_whatsapp ~ '^\+[1-9][0-9]{7,14}$' OR studio_whatsapp ~ '^01[0125][0-9]{8}$'),
  add constraint organizations_payment_text_printable
    check ((instapay_address IS NULL OR (instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND instapay_address !~ '[\u0001-\u001F\u007F-\u009F]' AND instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_name IS NULL OR (bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_name !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_account_holder IS NULL OR (bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_account_holder !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')));
```

### 0061 and the market price book database step: owner runbook

The market price book has ONE database step, and this is it: migration
`0061_market_price_book.sql` plus one new policy file and one new grant under
`rls/`. It is validated on branch `validate/market-price-book`, which also
carries `validate/landing-screens` (cdbf99d): its `db:apply-rls` keeps that
branch's `40-delivery-read.sql` fix.

**THE ORDER (do not change it):**

1. **The database goes first**, from the `validate/market-price-book` branch
   (steps 1 to 4 below), while production still runs the current `main`.
2. **Then** the branch is merged to `main` and deployed (the Deploy workflow
   green), and you run the smoke test (step 5).

Why this order, one sentence each:

- **The new code needs 0061:** every read of `cost_items` now names
  `market_item_id`, so new code on a database without 0061 fails every price
  book page with 42703.
- **The current Worker is safe on the 0061 database:** 0061 only ADDS (a
  nullable column, five enum labels, five new tables nobody reads yet). A
  tester ran main's own action tests on a 0061 database: 1062 of 1063 passed,
  exactly as on a 0060 one (the one failure is a harness artefact of that
  test machine, on both).
- **The rollback floor arrives with the first new unit, not with 0061:** see
  *Rolling back*.

**What it changes.** No row is touched and nothing is backfilled.

| Object | Change |
|---|---|
| `cost_item_unit` | five labels appended: `kg`, `ton`, `liter`, `cbm`, `roll`. IRREVERSIBLE (Postgres cannot drop an enum label); harmless while unused |
| five new enum types | `market_publisher`, `market_bulletin_status`, `market_unit`, `market_item_status`, `market_observation_status` |
| five new tables | `market_categories`, `market_items`, `market_bulletins`, `market_price_observations`, `market_item_details`: platform-level (no `org_id`), empty until the first `market:publish` |
| CHECKs on the data | a price is above 0 and at most 10,000,000, and no month is after its bulletin's month (the observation carries its bulletin's month through a composite FK); each bulletin records the gate's git commit |
| `cost_items.market_item_id` | new, nullable, every row NULL; FK to `market_items` (on delete restrict, added NOT VALID then validated) and the partial index `cost_items_org_market_item_idx` |
| `rls/policies/60-market.sql` | the five tables: RLS enabled and forced, one SELECT policy `market_read` each (a member org context; published bulletins only; an item only while a published bulletin prices it) |
| `rls/roles.sql` | `metra_app` gets SELECT on the five tables and nothing else |

**1. Put the market price book code in the production checkout.** Detach onto
the branch. This step adds a workspace package (`packages/market-ingest`) and
no dependency of `db:migrate` or `db:apply-rls`, so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/market-price-book
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 4ab2d5d HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (4ab2d5d)
```

If the diff lists any other file, STOP and tell the lead.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the
LAST result of what you run, so run each block below ON ITS OWN: paste it,
run it, note the result, then the next one.

(a) How many migrations are recorded. Expect `migrations` 61 and `newest`
1791767848859 (0060's journal stamp).

```sql
-- 0061 step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP.** `server_ok` true (0061
needs PostgreSQL 12 or later; Supabase runs 17), `cost_item_units` exactly
`sqm,linear_meter,pcs,lump_sum,day`, and `market_relations`,
`market_types` and `link_column` all 0. Anything else means part of the
market price book is already in this database: do not run step 3, tell the
lead.

```sql
-- 0061 step 2 (b): the pre-check. Run this one alone.
select current_setting('server_version_num')::integer >= 120000 as server_ok,
       (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
          from pg_enum e join pg_type t on t.oid = e.enumtypid
         where t.typname = 'cost_item_unit') as cost_item_units,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname like 'market\_%') as market_relations,
       (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'public' and t.typname like 'market\_%') as market_types,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'cost_items' and column_name = 'market_item_id') as link_column;
```

(c) How many price book items there are. Note the number; step 4 expects the
same.

```sql
-- 0061 step 2 (c): cost items. Run this one alone.
select count(*) as cost_items from cost_items;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** Both commands print routine NOTICE blocks
(several lines each, with `severity: 'NOTICE'` and a `message:` line). They
are not failures. The production-shaped rehearsal (a database built by main's
own migrations and main's own `rls/`, with the Supabase API roles) printed
these `message:` lines (on Supabase a line about a role may differ; any line
that ends `does not exist, skipping` or `already exists, skipping` is the
same kind):

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`, in this order:
  `message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`
  then FIVE new ones, once only (the first run creates the policies they
  drop): `message: 'policy "market_read" for relation "public.market_categories" does not exist, skipping',`
  and the same for `public.market_items`, `public.market_bulletins`,
  `public.market_price_observations` and `public.market_item_details`. A
  second `db:apply-rls` prints only the first four.

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure. Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (62).
- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on `51 tables, 51 policies, 15 triggers, 44 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 10 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
- `assert-schema-applied` exits 0 and prints six lines, in this order:
  `assert-schema-applied: OK — 51 declared table(s), every column present.`,
  then `indexes — 116 declared, all present.`, `constraints — 275 declared, all present.`,
  `functions — 44 declared, all present.`,
  `orphaned org rows — 44 org-scoped table(s) answered, none holds a row whose org_id names no organization.`
  and `composite set-null FKs — 13 found (13 declared in src/schema/), every one narrowed to a single non-org_id column.`
  (The middle four are report only and do not fail it. On an empty database
  the orphaned-rows line says it read 0 rows from organizations instead.)

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  A long query held `cost_items` for more than 3 s. Re-run `db:migrate` a
  little later (rehearsed by a tester: a 10 s reader gave exactly these lines,
  everything rolled back, and the re-run applied 0061). The same two codes
  from `db:apply-rls` print `apply-rls failed: ...` and end `(this file
  rolled back; the files before it stay applied).`: re-run `db:apply-rls`.
- `Migration failed: SQLSTATE P0001: 0061 needs PostgreSQL 12 or later ...`:
  the server is too old for this migration. Nothing changed; tell the lead.
- Any other code ends `tell the lead before running anything else`.

**Locks.** `db:migrate` runs 0061 as ONE transaction. The five new tables
are created empty. On `cost_items` it takes ACCESS EXCLUSIVE for the new
column (metadata only), the NOT VALID foreign key, the validation (every row
is NULL, so it checks nothing) and one index build, all held until the commit.
A tester measured about 357 ms at 1,000,000 cost items (linear, so a few ms at
pilot size), and 0 app errors under load. `db:apply-rls` adds one policy file
with five tables, the 5 x 3 s = 15 s worst case of the rule above.

**4. Read-only, after: expected results.** Again each block ON ITS OWN.

(a) `migrations` 62 and `newest` 1792248953024 (0061's journal stamp).

```sql
-- 0061 step 4 (a): migrations recorded now. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) Step 2 (b) again, as its own block. Now `cost_item_units` is
`sqm,linear_meter,pcs,lump_sum,day,kg,ton,liter,cbm,roll`, `market_relations`
21, `market_types` 10 and `link_column` 1 (`server_ok` still true).

(c) 5 rows, one per market table, every one with `rls` true, `forced` true,
`policies` 1, `app_select` true, `app_writes` false and `api_roles_read`
false.

```sql
-- 0061 step 4 (c): the market tables' RLS and grants. Run this one alone.
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       has_table_privilege('metra_app', c.oid, 'select') as app_select,
       has_table_privilege('metra_app', c.oid, 'insert')
         or has_table_privilege('metra_app', c.oid, 'update')
         or has_table_privilege('metra_app', c.oid, 'delete') as app_writes,
       has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select') as api_roles_read
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('market_categories', 'market_items', 'market_bulletins', 'market_price_observations', 'market_item_details')
order by 1;
```

(d) `cost_items` the same number as step 2 (c), and `linked` 0.

```sql
-- 0061 step 4 (d): cost items, none linked yet. Run this one alone.
select count(*) as cost_items, count(market_item_id) as linked from cost_items;
```

**5. Afterwards: merge, smoke test, return the checkout to main.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Tell the lead the database step is done; the lead merges the branch and
   the Deploy workflow deploys it.
3. Smoke test on your own studio, with the log open (from
   `C:\Users\HP\merta-main\apps\web`: `npx wrangler tail metra-web`): open the
   price book, open "New item" and check the unit list now ends with kg, ton,
   liter, m³ and roll, then cancel without saving (see *Rolling back*: the
   first saved item in a new unit sets a floor). Expected: the page loads, and
   the log shows no `42703` and no `42501`.
4. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(1) The code** (a price book page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER). Once a
studio has saved an item in a new unit, read *Rolling back* first.

**(2) The schema, only if the market price book is abandoned.** Roll the code
back FIRST (1): a Worker with this code reads `cost_items.market_item_id` and
fails with 42703 the moment it is gone. Then run this ONE block, which drops
everything 0061 created except the five `cost_item_unit` labels (they cannot be
dropped and stay harmless). Rehearsed: step 2 (b) then reads
`market_relations`, `market_types` and `link_column` 0 again. Then tell the
lead: `60-market.sql` leaves the manifest and the market grant leaves
`roles.sql` in the same revert, or the next `db:apply-rls` fails on the
missing tables. 0061 stays recorded in `drizzle.__drizzle_migrations`; the
feature comes back only with a new migration.

```sql
-- 0061 undo (2): the market price book schema, as ONE transaction.
begin;
drop index if exists public.cost_items_org_market_item_idx;
alter table public.cost_items drop constraint if exists cost_items_market_item_id_market_items_id_fk;
alter table public.cost_items drop column if exists market_item_id;
drop table if exists public.market_item_details, public.market_price_observations, public.market_bulletins, public.market_items, public.market_categories;
drop type if exists public.market_observation_status, public.market_item_status, public.market_unit, public.market_bulletin_status, public.market_publisher;
commit;
```

### 0062 and the market price book at sign-up: owner runbook

Every new studio gets the market price book automatically right after
sign-up (the onboarding screen fires it as a request of its own once the
studio exists, so it never slows or fails the sign-up), and an empty price
book offers the same load as a button. Both read a derived table,
the **seed book** (`market_seed_book`): every published market item as a
studio's price book would receive it, built by the same code as
`market:seed-price-books`. This is its ONE database step: migration
`0062_market_seed_book.sql` plus one policy and one grant under `rls/`. It is
validated on branch `validate/market-seed-on-signup`.

**THE ORDER (do not change it):**

1. **The database goes first**, from the branch (steps 1 to 4 below): the
   table, its RLS, and the seed book built from what is published, while
   production still runs the current `main`.
2. **Then** the branch is merged to `main` and deployed, and you run the
   smoke test (step 5).

Why this order, one sentence each:

- **The new code needs 0062, with the book built:** the sign-up seed (`POST
  /api/price-book/market-seed`) and the empty price book's button read
  `market_seed_book`; without the table they fail with 42P01, and with the
  table still empty a new studio gets nothing and the button says the book
  is being prepared. A sign-up itself always succeeds (the seed is a separate
  request, and its failure is one log line with a reference).
- **The current Worker is safe on the 0062 database:** 0062 only adds a table
  nobody reads yet.
- **There is no rollback floor:** the table is derived data; any Worker
  version runs on it.

**What it changes.** No row is touched and nothing is backfilled.

| Object | Change |
|---|---|
| `market_seed_book` | new platform-level table (no `org_id`), one row per published market item: code, seeded names, the forms a studio's own item clashes with, studio unit, cost and cost x 1.05, sub-category. FK to `market_items` (on delete cascade). Starts EMPTY |
| `rls/policies/60-market.sql` | RLS enabled and forced on it, one SELECT policy `market_read` (a member org context) |
| `rls/roles.sql` | `metra_app` gets SELECT on it and nothing else |

Who writes it: `market:publish` and `market:withdraw` rebuild it whole in
their own transaction; `market:rebuild-seed-book` rebuilds it and seeds no
studio (step 3); and every REAL `market:seed-price-books` run (not a dry run)
rebuilds it under the market write lock before it seeds. The app only
reads it. A seed writes each item BY REFERENCE to it (its names and prices are
taken from the book), so a seed holds the book steady for the length of one
studio's transaction, the app's and a real CLI run's alike. Between two
studios a CLI run holds nothing: each studio's transaction checks the book is
still the one the run planned from, and when a publish or withdrawal changed
it the run stops there (`STOPPED`, exit 1) and a re-run plans from the new
book. A `market:publish` or `market:withdraw` that meets a seed waits up to
3 s and then stops with a lock timeout that names the holder; run it again a
moment later.

**1. Put the code in the production checkout.**

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/market-seed-on-signup
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat a01ffb84 HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (a01ffb84)
```

If the diff lists any other file, STOP and tell the lead.

**2. Read-only, before** (Supabase SQL editor), each block ON ITS OWN.

(a) Expect `migrations` 62 and `newest` 1792248953024 (0061's journal stamp).

```sql
-- 0062 step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK: `seed_book` 0, or STOP.**

```sql
-- 0062 step 2 (b): the pre-check. Run this one alone.
select count(*) as seed_book from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'market_seed_book';
```

**3. Migrate, apply RLS, prove it landed, then build the seed book.** From
`C:\Users\HP\merta-main`, in a PowerShell window where you also set
`$env:MARKET_DATABASE_URL` as in *Monthly market bulletin* (the direct or
session-pooler connection, never the `:6543` transaction pooler):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
npm run market:rebuild-seed-book
```

Expect `Migrations applied.`, then `apply-rls: verified in the catalogues — 52
tables, 52 policies, 15 triggers, 44 functions, ...` and a `grants verified`
line naming 11 narrowed tables (`market_seed_book` among them), then
`assert-schema-applied: OK — 52 declared table(s), every column present.`,
then `market:rebuild-seed-book: the seed book holds 456 published market
item(s); no studio was seeded` (456 with July 2026 published; 0 with no
bulletin, and the first `market:publish` builds it). It writes the book only:
no studio row, ever.

**4. Read-only, after.** Each block ON ITS OWN.

(a) `migrations` 63 and `newest` 1792272891040 (0062's journal stamp): step 2
(a) again.

(b) One row: `rls` true, `forced` true, `policies` 1, `app_select` true,
`app_writes` false, `api_roles_read` false, `entries` the number step 3
printed (456 for July 2026).

```sql
-- 0062 step 4 (b): the seed book's RLS and grants, and its size. Run this one alone.
select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       has_table_privilege('metra_app', c.oid, 'select') as app_select,
       has_table_privilege('metra_app', c.oid, 'insert')
         or has_table_privilege('metra_app', c.oid, 'update')
         or has_table_privilege('metra_app', c.oid, 'delete') as app_writes,
       has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select') as api_roles_read,
       (select count(*) from public.market_seed_book) as entries
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'market_seed_book';
```

**5. Afterwards: merge, smoke test.**

1. **Stop and do not merge** if any output in steps 3 or 4 differs from what
   is written there. Tell the lead what you saw instead.
2. Tell the lead the database step is done; the lead merges and the Deploy
   workflow deploys.
3. Smoke test, with the log open (`npx wrangler tail metra-web` from
   `C:\Users\HP\merta-main\apps\web`): sign up a test studio with a second
   email address. Its price book lists the market items within a few
   seconds (a reload may be needed), and the log shows no `42P01`, `42501` or
   `mutateInOrg failed` line. Tell the lead which test studio to remove.
4. Put the production checkout back on main (`git switch --detach
   origin/main` after a fetch).

**Undo, if ever needed.**

**(1) The code:** `npx wrangler rollback <version-id>` with the version that
served before the merge. Leave the database alone: the older Worker never
reads the table.

**(2) The schema, only if this is abandoned:** roll the code back FIRST (1),
then run `drop table if exists public.market_seed_book;` on its own, and tell
the lead: its policy leaves `60-market.sql` and its grant leaves `roles.sql`
in the same revert, or the next `db:apply-rls` fails on the missing table.

**(3) The seeded items:** a studio seeded at sign-up or from its empty price
book has the same `MKT-` codes and market links as one the CLI seeded, so the
undo of *Seeding studio price books from the market book* removes them too.

### The rescue ledger and the studio read budgets (PR BR): smoke test

No database step. The deploy adds two Rate Limiting bindings, which
`wrangler deploy` creates from `apps/web/wrangler.jsonc`:
`STUDIO_READ_RATE_LIMITER` (namespace 1005, 30 per 60 s: the rescue ledger
route) and `STUDIO_SEARCH_RATE_LIMITER` (namespace 1006, 120 per 60 s: the
contract line picker, the price book picker and the market prices search).
Each is keyed per surface, workspace and member.

**Smoke test, right after the Deploy workflow is green (owner, 3 minutes),**
with `npx wrangler tail metra-web` open in a terminal (from `apps/web`):

1. Open the dashboard as the owner. The Rescue ledger block renders below the
   charts, with its cards and both monthly charts (zeros are fine on a quiet
   studio). A "We could not load the ledger" card instead is a failure.
2. Do one picker search: in a draft proposal's builder, open "From price book"
   and type a word. Matches (or "no matches") come back; a "Too many requests"
   line on the first search is a failure.
3. Read the tail. It must show NO line containing `limiter missing`. Such a
   line names the binding the deployed Worker lacks: the surface is refusing
   every request, and the fix is a redeploy with `wrangler.jsonc` intact.

### 0063 and Stage 2 DB step A (execution first release): owner runbook

Stage 2 (contract from BOQ, payment requests, payments, costs, measurements)
has TWO database steps, and this is the first: migration
`0063_execution_first_release.sql` plus `db:apply-rls` (two new files under
`rls/`, the replaced contract and change-order client functions, and the
policy speed-up below). It is validated on branch
`validate/stage2-a2-schema`. The second step (the client "I paid" on the
delivery page) is apply-rls only, around Nov 18, with its own runbook.

**THE ORDER (do not change it):**

1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge: a few pages and one harmless save in your own
   studio. If it fails, undo (0) puts the previous policies back.
3. **Then, right after that check,** the lead merges the branch to `main` and
   the Deploy workflow deploys it, and you run the smoke test (step 6). Do not
   leave a gap (see the last reason).

Why this order, one sentence each:

- **The new code needs 0063:** the contract and change-order reads now name
  `source_boq_id`, `item_code`, `provisional` and `time_extension_days`, so
  new code on a database without 0063 fails every contract page with 42703.
- **The current Worker is safe on the 0063 database:** 0063 only ADDS
  (nullable columns, new tables nobody reads yet), and the replaced client
  functions only add keys. Rehearsed: the current app's own contract and
  change-order code, unchanged, reads, acknowledges and responds on the 0063
  database.
- **No client sees a change in what a contract says:** the contract link (/c)
  still shows every line of every section; it only carries more keys (the
  schedule, a digest of every line, the item codes). One visible difference:
  lines that share a sort order now always appear in the same order, by sort
  order and then by id, the order the studio page uses since PR B1 (before,
  ties came back in whatever order the database stored them). The lazy loading of long
  sections arrives with PR A3, and the snapshot is only cut to 50 lines per
  section in DB step B (Nov 18), once that page is live.
- **A signature or a change-order decision now also writes studio
  notifications,** for every contract, quote contracts included. This branch
  teaches the bell to show them ("The client signed contract C-2026-0007",
  "approved change order VO-..."). Until it is deployed, the current Worker
  shows them as an empty line (it renders an unknown notification as nothing,
  never as an error), which is why the merge follows step 5 at once.

**What it changes.** No existing row is updated and nothing is backfilled.

| Object | Change |
|---|---|
| `contracts` | `source_proposal_id` may be empty; new `source_boq_id` (the issued BOQ an execution contract comes from) with its same-org FK, one contract per BOQ, and the CHECK `contracts_one_source` (exactly one of the two is set; every existing contract has a proposal and no BOQ) |
| `contract_lines` | new `item_code` (empty) and `provisional` (false), one unique index `(org_id, contract_id, id)`, and a 3-column foreign key: a line's section is a section of its own contract (added NOT VALID, then validated over every existing line; step 2 (e) checks first) |
| `contract_sections` | one unique index `(org_id, contract_id, id)` |
| `variation_orders` | new `time_extension_days` (empty), CHECK 0 to 3650, and one unique index `(org_id, contract_id, id)` |
| three new enum types | `payment_request_kind`, `payment_request_status`, `cost_category` |
| six new tables | `contract_payment_milestones`, `payment_requests`, `contract_payments`, `contract_payment_claims`, `contract_cost_entries`, `contract_line_measurements` (the FINAL measured quantity per line at handover, ordered by an identity `seq`): per studio (`org_id`), empty. Every link to a line, a section, a request, a milestone or a change order is a 3-column foreign key, so it can only name a row of the SAME contract. Every money CHECK also refuses NaN; a cost description must hold a visible character |
| `rls/policies/35-execution.sql` | the six tables: RLS enabled and forced, one `org_isolation` policy each, and three triggers: the schedule freezes with its contract; a payment request can only go issued to void, never once paid; a payment fits its request (issued, and never more than its amount, under the request's row lock) |
| `rls/functions/35-execution.sql` | the payment request's frozen guard and the payment-fits guard |
| `enforce_contract_child_draft()` (`30-contracts-variations.sql`) | reads the parent contract `FOR SHARE`, so a schedule edit racing an issue waits for it and is refused, instead of landing in a sent contract |
| `rls/functions/30-contracts-variations.sql` | the contract link (/c) adds the payment schedule, a digest of every line, item codes, the provisional flag and the day and way a signed contract was signed (online or on paper), and still carries every line (a new function serves one section's lines 100 at a time, for PR A3's page, reading that section only); signing notifies owners, admins and project managers, and waits at most 4 s behind a studio save holding the contract (the client is then told to refresh and check, and nothing is signed later); the change-order link (/v) adds VAT, supervision and the extra days; a decision notifies the same three roles |
| every `rls/policies/*.sql` | **the policy speed-up:** each studio policy now reads the org context and the membership check ONCE per query instead of once per row (`(select ...)`). Same answer, about 40 times faster on a big contract (measured: 492.6 ms before, 11.4 ms after, on a 50,000-line contract). Applied by this same `db:apply-rls`; nothing extra to run |
| `rls/roles.sql` | `metra_app`: full access to the schedule; requests, claims and costs without delete; payments insert and read only; measurements read, and insert on every column but `seq`. Each written `revoke all`, then the exact grant. The new functions are callable by `metra_app` only |

**1. Put the Stage 2 schema code in the production checkout.** This step adds
no dependency of `db:migrate` or `db:apply-rls`, so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/stage2-a2-schema
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat b43919ab HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (b43919ab)
git diff --stat b415d66b origin/main -- packages/db    # MUST print nothing: main's database code is still the one undo (0) restores
```

Two STOPs, tell the lead in either case:

- The first diff lists any file other than `docs/DEPLOY.md`: the code is not
  the code that was rehearsed.
- The second diff prints anything: someone changed the database code on
  `main` after this branch was cut, so this branch's `db:apply-rls` would
  remove that change and undo (0) would not restore it.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the
LAST result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 63 and `newest` 1792272891040 (0062's journal stamp).

```sql
-- 0063 step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** every column 0. Anything
else means part of Stage 2 is already in this database (or, for
`contracts_without_proposal`, a contract the CHECK would refuse): do not run
step 3, tell the lead.

```sql
-- 0063 step 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'source_boq_id') as boq_column,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'variation_orders' and column_name = 'time_extension_days') as extension_column,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('contract_payment_milestones', 'payment_requests', 'contract_payments', 'contract_payment_claims', 'contract_cost_entries', 'contract_line_measurements')) as execution_tables,
  (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname in ('payment_request_kind', 'payment_request_status', 'cost_category')) as execution_types,
  (select count(*) from public.contracts where source_proposal_id is null) as contracts_without_proposal;
```

(c) The sizes the migration works on. Note the five numbers; step 4 (e)
expects the same. `most_lines_in_one_contract` and `contract_lines` set how
long the migration holds the contract tables (see *Locks*).

```sql
-- 0063 step 2 (c): the contract tables' sizes. Run this one alone.
select (select count(*) from public.contracts) as contracts,
       (select count(*) from public.contract_sections) as contract_sections,
       (select count(*) from public.contract_lines) as contract_lines,
       (select coalesce(max(n), 0) from (select count(*) as n from public.contract_lines group by contract_id) per_contract) as most_lines_in_one_contract,
       (select count(*) from public.variation_orders) as variation_orders;
```

(d) How many studio policies still read the membership check once per row.
Expect `policies` 52 and `per_row` 46 (the six market policies are already
in the once-per-query form). Note them; step 4 (d) expects 58 and 0.

```sql
-- 0063 step 2 (d): policies that read the membership check per row. Run this one alone.
select count(*) as policies,
       count(*) filter (where regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
         '\(\s*SELECT app_is_current_org_member\(\) AS app_is_current_org_member\)', '', 'g')
         ~ 'app_is_current_org_member\(\)') as per_row
from pg_policies where schemaname = 'public';
```

(e) **THE LINE CHECK: 0, or STOP.** 0063 adds a foreign key saying a contract
line's section belongs to the line's own contract, and validates it over
every existing line. Lines are only ever written together with their section,
so expect 0. Anything else would make step 3 fail with 23503 (and change
nothing): do not run step 3, tell the lead the number.

```sql
-- 0063 step 2 (e): contract lines whose section is another contract's. Run this one alone.
select count(*) as lines_in_another_contracts_section
from public.contract_lines l
join public.contract_sections s on s.id = l.section_id
where s.contract_id <> l.contract_id or s.org_id <> l.org_id;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** Both commands print routine NOTICE blocks with
a `message:` line. The production-shaped rehearsal (a database built by the
0062 code, 200 contracts, 1,000,000 contract lines and 400 change orders on it,
then this branch) printed these, and on Supabase a line about a role may
differ; any line that ends `does not exist, skipping` or `already exists,
skipping` is the same kind:

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`, in this order:
  `message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`
  then SIX new ones, once only: `message: 'policy "org_isolation" for relation "public.contract_payment_milestones" does not exist, skipping',`
  and the same for `public.payment_requests`, `public.contract_payments`,
  `public.contract_payment_claims`, `public.contract_cost_entries` and
  `public.contract_line_measurements`, then THREE new ones, once only:
  `message: 'trigger "trg_contract_payment_milestones_parent_draft" for relation "public.contract_payment_milestones" does not exist, skipping',`,
  `message: 'trigger "trg_payment_requests_frozen" for relation "public.payment_requests" does not exist, skipping',`
  and `message: 'trigger "trg_contract_payments_fits" for relation "public.contract_payments" does not exist, skipping',`.
  A second `db:apply-rls` prints only the first four.

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure. Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (64).
- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on `58 tables, 58 policies, 18 triggers, 47 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 16 narrowed table(s) (boqs, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  If that second line is replaced by a problem list naming a policy the
  manifest does not declare, or a TRUNCATE, REFERENCES or TRIGGER grant, it
  exits 1: something was added by hand. Do not merge; tell the lead.
  The policy speed-up prints nothing of its own: the same 58 policies are
  re-created in their new form (step 4 (d) shows it).
- `assert-schema-applied` exits 0 and prints six lines, in this order:
  `assert-schema-applied: OK — 58 declared table(s), every column present.`,
  then `indexes — 133 declared, all present.`, `constraints — 340 declared, all present.`,
  `functions — 47 declared, all present.`,
  `orphaned org rows — 50 org-scoped table(s) answered, none holds a row whose org_id names no organization.`
  and `composite set-null FKs — 15 found (15 declared in src/schema/), every one narrowed to a single non-org_id column.`
  (The middle four are report only and do not fail it.)

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  Long queries held the tables 0063 needs for more than 3 s in total (see
  *Locks*). Re-run `db:migrate` a little later. Rehearsed: a reader holding
  `contract_lines` for 10 s gave exactly these two lines after 3 s,
  `migrations` stayed 63, no column was added, and the re-run after the reader
  finished applied 0063. The same two
  codes from `db:apply-rls` print `apply-rls failed: ...` and end `(this file
  rolled back; the files before it stay applied).`: re-run `db:apply-rls`.
- `Migration failed: SQLSTATE 23514: ... "contracts_one_source"`: a contract
  without a proposal, which step 2 (b) would have shown. Nothing changed; tell
  the lead.
- `Migration failed: SQLSTATE 23503: ... "contract_lines_section_same_contract_fk"`:
  a line in another contract's section, which step 2 (e) would have shown.
  Nothing changed; tell the lead.
- `Migration failed: SQLSTATE P0001: 0063: ... composite set-null foreign
  key(s) ...`: a foreign key the 0052 rule forbids. Nothing changed; tell the
  lead.
- Any other code ends `tell the lead before running anything else`.

**Safe to re-run.** `db:migrate` records 0063 only when the whole batch
commits, so after any failure a re-run starts again from 0062; after a
success it finds nothing pending and prints `Migrations applied.` again
(rehearsed). Every statement under `rls/` is idempotent: a second
`db:apply-rls` prints the same two verified lines and only the first four
notices (rehearsed). `assert-schema-applied` only reads.

**Locks.** `db:migrate` runs 0063 as ONE transaction. It first takes every
lock it needs, in one fixed order, within ONE 3 s budget for all of them
together: ACCESS EXCLUSIVE (no reads, no writes) on `contracts`,
`contract_sections`, `contract_lines` and `variation_orders`, then SHARE ROW
EXCLUSIVE (reads go on, writes wait) on `boqs`, `cost_items` and
`organizations`. 3 s is the most it waits in total, not per table: if busy
tables one after the other use the budget up, it stops with the 55P03 lines
above and nothing changes. So contract pages wait at most about 3 s for the
lock waits plus the migration's own work, then it commits and releases
everything. Rehearsed: two readers, one holding `contract_lines` for 2 s and
one holding `variation_orders` for 8 s, made it give up with 55P03 after 3 s
in total; an app reader of a contract (5 s lock wait) waited at most 3,015 ms
and saw 0 errors. Without blockers the work is about 0.3 s at 100,000
contract lines and about 2.1 s at 1,000,000 (the largest steps are the new
unique index and the validation of the new section foreign key on
`contract_lines`, both linear in its rows); through a real `db:migrate` on
1,000,000 lines that app reader waited at most 2,111 ms and saw 0 errors. Step 2 (c) gives the size to
compare with. `design_engagements` (the table every client act locks) is not
touched. Pilot volumes are far below 100,000 lines; run it at a quiet moment
anyway. Estimates from a local server, not a production measurement.
`db:apply-rls` adds one policy file with six NEW tables (nothing waits on
them), and every existing policy file runs as it always does (the 11 x 3 s =
33 s worst case of `10-catalogue.sql` is unchanged).

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) `migrations` 64 and `newest` 1792363603266 (0063's journal stamp): step 2
(a) again.

(b) Step 2 (b) again: now `boq_column` 1, `extension_column` 1,
`execution_tables` 6, `execution_types` 3 and `contracts_without_proposal` 0.

(c) 6 rows, every one with `rls` true, `forced` true, `policies` 1 and
`api_roles_read` false; `app_privileges` exactly:
`contract_cost_entries` S,I,U; `contract_line_measurements` S (its INSERT is
per column, see (g)); `contract_payment_claims` S,I,U;
`contract_payment_milestones` S,I,U,D; `contract_payments` S,I;
`payment_requests` S,I,U. And `triggers` 1 on `contract_payment_milestones`,
`contract_payments` and `payment_requests`, 0 on the others.

```sql
-- 0063 step 4 (c): the six tables' RLS, grants and triggers. Run this one alone.
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       concat_ws(',',
         case when has_table_privilege('metra_app', c.oid, 'select') then 'S' end,
         case when has_table_privilege('metra_app', c.oid, 'insert') then 'I' end,
         case when has_table_privilege('metra_app', c.oid, 'update') then 'U' end,
         case when has_table_privilege('metra_app', c.oid, 'delete') then 'D' end) as app_privileges,
       has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select') as api_roles_read,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('contract_payment_milestones', 'payment_requests', 'contract_payments', 'contract_payment_claims', 'contract_cost_entries', 'contract_line_measurements')
order by 1;
```

(d) Step 2 (d) again: now `policies` 58 and `per_row` 0.

(e) Step 2 (c) again: the same five numbers as before.

(f) The client functions and the payment-fits guard: 6 rows, every one with
`app_execute` true and `public_execute` false and `api_roles_execute` false.
(The guard runs as the caller, under RLS, so it can say nothing about another
studio's request; it is locked down anyway, like every function here.)

```sql
-- 0063 step 4 (f): who may call the contract and change-order client functions. Run this one alone.
select p.proname,
       has_function_privilege('metra_app', p.oid, 'execute') as app_execute,
       exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute,
       coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated', 'service_role')), false) as api_roles_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_contract_by_token', 'app_contract_section_lines_by_token', 'app_contract_ack_by_token',
                    'app_variation_by_token', 'app_variation_respond_by_token', 'enforce_contract_payment_fits')
order by 1;
```

(g) Who may write a measurement's recording order: 12 rows, `insertable`
true on every column except `seq`, which is false (nobody but the database
chooses the order of the final measured quantities).

```sql
-- 0063 step 4 (g): which measurement columns metra_app may insert. Run this one alone.
select a.attname as column_name,
       has_column_privilege('metra_app', a.attrelid, a.attnum, 'insert') as insertable
from pg_attribute a
where a.attrelid = 'public.contract_line_measurements'::regclass and a.attnum > 0 and not a.attisdropped
order by a.attnum;
```

**Stop and do not go on** if any output in steps 3 or 4 differs from what
is written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still
runs the current `main`; this checks it against the policies step 3 just
replaced. About ten minutes, in your own studio only. Open the log first, in
a second window, and leave it open:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

Then, signed in to your own studio:

1. **Page loads.** Open the dashboard, Clients and one client, Projects and
   one project, then **Contracts** in the sidebar and one contract (and, on
   that contract's **Variation register** tab, سجل أوامر التغيير, one change
   order if it has any), and the price book. Expected: every page
   loads and shows your data as before. A list that is suddenly EMPTY counts
   as a failure too: a policy that refuses hides rows, it does not show an
   error.
2. **One harmless save.** Pick one of your own clients, open its **Details**
   tab, add a word at the end of **Notes** (for example `check`), press
   **Save details**: expected `Details saved`. Then delete that word, press
   **Save details** again: expected `Details saved`. In Arabic the same
   labels read التفاصيل, ملاحظات, حفظ التفاصيل and تم حفظ التفاصيل. Reload the page: Notes
   read exactly as before. (Notes are private to your studio and never shown
   to the client; your audit log records the two edits, nothing else
   changes.)
3. **The client links, only if you have a test one.** If a test project of
   yours has a contract link (`/c/...`) or a change-order link (`/v/...`)
   you sent to yourself, open each: it shows the document as before. Only
   look: do not sign, acknowledge, approve or reject anything. No test link:
   skip this; do not create one for it.

Expected in the log for all of the above: no `42501`, no `42703`, no
`mutateInOrg failed`.

**If anything in step 5 fails** (a page errors or shows a list empty that was
not, the save does not say `Details saved`, or the log shows one of those
three): do not merge. Run undo (0) below now, then tell the lead what you
saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (within the hour, see THE ORDER).
2. Smoke test on your own studio, the log still open: the page loads of step
   5 (1) again, now on the new code. Expected: every page loads, and the log
   shows no `42703`, no `42501` and no `mutateInOrg failed`. If a test client
   contract link of yours exists, open it: it shows the contract as before.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(0) The policies, before the merge** (step 5 fails, or before the merge the
log shows a `42501` or a studio reports a broken page). This is the PREVIOUS
`main`'s own `db:apply-rls` (the code at `b415d66b`, the one the site runs
now), run on the 0063 database. It puts back, exactly as they were before
step 3: every studio policy (in the once-per-row form), the contract and
change-order client functions (the /c read and acknowledgement, the /v read
and response; a signature stops writing studio notifications again) and the
child-draft guard. It leaves 0063 itself alone: the new columns, the six new
tables with their RLS, policies, grants and triggers, and the three new
functions stay exactly as step 3 made them (the current site never touches
them). Use it only while the site still runs the code from before the merge:
if the new code is already deployed, undo (1) the code first, then this.

The checkout you switch to below does not contain this runbook, so first
save a copy and read the rest of undo (0) from that copy:

```powershell
cd C:\Users\HP\merta-main
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-0063.md
git fetch origin
git switch --detach b415d66b
git log --oneline -1    # b415d66b merge: main (A1 money engine) into the bounded contract pages
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout: the previous code does not know
0063, and nothing else is needed. Expected:

- It exits 0. NOTICE blocks: only the FIRST FOUR of step 3 (the two `does not
  exist, skipping` functions, `role "postgres" has already been granted
  membership ...` and `policy "self_memberships" ... does not exist,
  skipping`), nothing about the six new tables.
- It ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on
  `52 tables, 52 policies, 15 triggers, 44 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 11 narrowed table(s) (boqs, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, workspace_entitlements) holding exactly what rls/roles.sql leaves them.`
  The numbers are smaller than step 3's on purpose: the previous code counts
  only what it declares, and the six new tables are not in its list (it does
  not touch them).
- A failure prints `apply-rls failed: ...` with the SQLSTATE, as in step 3,
  and the same advice holds (55P03 or 40P01: run it again a little later).

Then, read-only (Supabase SQL editor, each block ON ITS OWN):

- Step 2 (d) again: `policies` 58 and `per_row` 46. The 46 studio policies
  are back in the per-row form; the six market policies and the six new ones
  were written in the once-per-query form and stay so.
- Step 4 (c) again: exactly what step 4 (c) expects (the six new tables are
  untouched).
- Step 4 (f) again: exactly the 6 rows step 4 (f) expects.

Then step 5 again: everything works as it did before step 3. Put the
checkout back on main (step 6 (3)) and tell the lead what failed the first
time. Do not merge. If step 5 STILL fails after undo (0), the policies were
not the cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then
from step 3 only `npm run db:apply-rls` (0063 is still applied, so
`db:migrate` is not needed). Expected: the step 3 lines of a SECOND run (the
first four notices only, and the same two verified lines), then step 4 (d)
`policies` 58 and `per_row` 0, then step 5 and on.

Rehearsed on a local database built by the 0062 code: 0063 and this branch's
`db:apply-rls`, then the previous `main`'s `db:apply-rls` printed exactly the
lines above and exited 0. A catalogue comparison then found every policy,
function, trigger and grant of the previous `main` identical to the database
before step 3, and the 0063 objects identical to after step 3. The previous
`main`'s own action tests (contracts, change orders, clients, projects, the
price book and the rest: 1,139 of 1,141; the other two only count schema
objects, and count the ones 0063 adds on any 0063 database) and its
cross-tenant isolation gate (58 of 58) passed on it. The same tests passed
before the undo too, on this branch's policies, which is what step 5 checks
on the live site.
This branch's `db:apply-rls` afterwards gave a database identical to the
first run's, and this branch's tests passed on it.

**(1) The code** (a contract page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**(2) The schema, only if Stage 2 is abandoned, and only while no execution
contract exists.** Tell the lead first: it is a revert of `rls/` and a new
migration, never a hand edit here. The policy speed-up is NOT undone by it
and needs no undo: it changes how often the same check runs, not what it
answers.

### Site diary DB step S (0064, Stage 3 site app): owner runbook

The site engineer app (Stage 3) has ONE database step, and this is it:
migration `0064_site_diary.sql` plus `db:apply-rls` (three new files under
`rls/`, one new function beside its sibling in `functions/00-org-context.sql`,
one new trigger beside the `projects` policy in `policies/10-catalogue.sql`,
and new grants in `rls/roles.sql`). It is validated on branch
`validate/site-s2-schema`. Nothing in the app uses the new tables yet: the
first code that writes them is PR S3 (assignments) and PR S4 (check-in).

**THE ORDER (do not change it):**

1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge.
3. **Then, right after that check,** the lead merges the branch to `main`, the
   Deploy workflow deploys it, and you run the smoke test (step 6).

Why this order, one sentence each:

- **The new code needs 0064:** the project page and the API's project reads
  select every column of a project, so they now name the five site pin
  columns, and new code on a database without 0064 fails them with 42703.
  (The API's project shape lists its fields one by one, so the pin never
  reaches an API key.)
- **The current Worker is safe on the 0064 database:** 0064 only ADDS (five
  empty columns on `projects`, one unique key on `contracts`, one text check
  function, seven new empty tables), and this `db:apply-rls` changes NO
  existing policy, function or grant. It adds ONE trigger to an existing
  table, `projects`: it watches the five new pin columns only, which the
  current code never writes, so it never fires for it. Rehearsed: a catalogue
  fingerprint of every policy, function, trigger and table grant was identical
  before and after step 3, except for the 51 new objects; and the
  current `main`'s own isolation gate and action tests passed on the 0064
  database, but for two tests that only count schema objects (see
  *Rehearsed* at the end).
- **No client and no studio sees anything new** until PR S4 ships: the tables
  are empty and nothing reads them.

**What it changes.** No existing row is updated and nothing is backfilled.

| Object | Change |
|---|---|
| `projects` | five new empty columns, the SITE PIN (`site_lat`, `site_lng`, `site_radius_m`, `site_pin_set_by`, `site_pin_set_at`), and two CHECKs: all five set or none, and the point and a 30 to 2000 m radius in range (added NOT VALID, then validated: every existing row has all five empty). In `db:apply-rls`, one trigger: only an owner, admin or project manager sets, moves or clears a pin; an assigned site engineer only sets a missing one |
| `contracts` | one unique key `(org_id, project_id, id)`, so a material delivery can only name a contract of its own project |
| five new enum types | `site_location_status`, `site_presence`, `site_photo_source`, `site_photo_status`, `site_note_kind` |
| one new function | `text_has_visible_character`: a delivery's description and a note's body must hold a visible character (an entry made only of invisible marks is refused) |
| seven new tables | `project_assignments`, `site_location_consents`, `site_devices`, `site_visits`, `site_photos`, `site_material_receipts`, `site_notes`: per studio (`org_id`), empty, and with RLS enabled and forced from the moment they exist (no policy yet, so nobody reads or writes them until step 3's `db:apply-rls`). A photo, a delivery and a note can only name a visit of their own project, and a delivery only a photo of its own project (3-column foreign keys). A photo stores no storage key: its keys are derived from its studio, project and id |
| `rls/policies/70-site.sql` | the seven tables: RLS enabled and forced, one `org_isolation` policy each, plus FIFTEEN restrictive policies: a site engineer writes and updates diary rows only on a project he is assigned to, always in his own name, and accountants, viewers and the client role write nothing; only an owner, admin or project manager assigns or revokes; a location consent is recorded or withdrawn only by its own person; a phone registers only itself, and a member sees and revokes only his own phones (a manager every phone). Eight guard triggers: a diary row is evidence (only its void, check-out, publication or coordinate purge may change, a voided row is frozen whole, nothing is ever deleted), only a manager publishes or changes what the client sees, a site engineer voids, checks out and marks stored only his own entries, a new row is checked as strictly as a change (nothing is inserted already published, stored, shown or voided), a visit's date is the Cairo day of its check-in, a revoke is final, and who an assignment or a phone is about never changes |
| `rls/functions/80-site.sql`, `85-site-portal.sql` | the two checks the restrictive policies call (may this person write on this project; does this person manage the studio), the "own row or a manager" rule, the photo storage key, the guards, and the client's published site updates by share token (published visits and the photos the studio chose only; never a location, a person, a note or a delivery) |
| `rls/functions/00-org-context.sql` | ADDS `app_current_user_orgs_for_session` beside `app_current_user_orgs` (which is unchanged): the same list, minus a studio where this phone was revoked (used from PR S8) |
| `rls/roles.sql` | `metra_app`: read, insert and update on the seven tables, never delete, each written `revoke all`, then the exact grant. The four new definer functions, and the "own row or a manager" rule, are callable by `metra_app` only |

**1. Put the site diary schema code in the production checkout.** This step
adds no dependency of `db:migrate` or `db:apply-rls`, so the installed
`node_modules` serve as they are.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/site-s2-schema
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 992bca1e HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (992bca1e)
git diff --stat 0f9cb2db origin/main -- packages/db    # MUST print nothing: main's database code is still the one undo (0) restores
```

Two STOPs, tell the lead in either case:

- The first diff lists any file other than `docs/DEPLOY.md`: the code is not
  the code that was rehearsed.
- The second diff prints anything: someone changed the database code on
  `main` after this branch was cut, so undo (0) would not restore it.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the
LAST result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 64 and `newest` 1792363603266 (0063's journal stamp).

```sql
-- Site diary step S 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** every column 0. Anything
else means part of the site diary is already in this database: do not run
step 3, tell the lead.

```sql
-- Site diary step S 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name like 'site\_%') as pin_columns,
  (select count(*) from pg_constraint where conname = 'contracts_org_project_id_unique') as contract_project_key,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('project_assignments', 'site_location_consents', 'site_devices', 'site_visits', 'site_photos', 'site_material_receipts', 'site_notes')) as site_tables,
  (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname in ('site_location_status', 'site_presence', 'site_photo_source', 'site_photo_status', 'site_note_kind')) as site_types,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('text_has_visible_character', 'app_may_write_site_project', 'app_may_manage_site_project', 'app_is_self_or_site_manager', 'site_photo_object_key', 'app_current_user_orgs_for_session', 'app_delivery_site_updates_by_token', 'enforce_site_entry_guard', 'enforce_site_photo_state', 'enforce_site_visit_guard', 'enforce_site_visit_date', 'enforce_site_revoke_final', 'enforce_site_pin_writer')) as site_functions,
  (select count(*) from pg_trigger where tgname = 'trg_projects_site_pin_writer') as pin_trigger;
```

(c) The sizes the migration works on. Note the two numbers; step 4 (e)
expects the same. They set how long the migration holds `projects` and
`contracts` (see *Locks*).

```sql
-- Site diary step S 2 (c): the sizes the migration works on. Run this one alone.
select (select count(*) from public.projects) as projects,
       (select count(*) from public.contracts) as contracts;
```

(d) Expect `policies` 58 and `restrictive` 0. Step 4 (d) expects 80 and 15.

```sql
-- Site diary step S 2 (d): policies, and how many are restrictive. Run this one alone.
select count(*) as policies,
       count(*) filter (where permissive = 'RESTRICTIVE') as restrictive
from pg_policies where schemaname = 'public';
```

(e) The database size. Write the number down: it goes in the release note,
and step 4 (h) reads it again.

```sql
-- Site diary step S 2 (e): the database size. Run this one alone.
select pg_size_pretty(pg_database_size(current_database())) as db_size;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection), **at a
quiet hour** (late evening, when no studio is working; see *Locks*):

```powershell
npm run db:migrate
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** Both commands print routine NOTICE blocks with
a `message:` line. The production-shaped rehearsal (a database built by the
0063 code, 5,002 projects, 5,002 contracts and 50,002 contract lines in 22 studios on it, then this branch)
printed exactly these; on Supabase the line about a role may differ, and any
line that ends `does not exist, skipping` or `already exists, skipping` is
the same kind:

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`, in this order:
  `message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`
  then ONE new one, once only, for the pin trigger:
  `message: 'trigger "trg_projects_site_pin_writer" for relation "public.projects" does not exist, skipping',`
  then TWENTY-TWO new ones, once only, one per new policy:
  `message: 'policy "org_isolation" for relation "public.project_assignments" does not exist, skipping',`
  and the same for `site_managers_insert` and `site_managers_update` on
  `public.project_assignments`; then `org_isolation`,
  `site_consent_self_insert` and `site_consent_self_update` on
  `public.site_location_consents`; then `org_isolation`,
  `site_device_self_insert`, `site_device_self_or_manager_select` and
  `site_device_self_or_manager_update` on `public.site_devices`; then
  `org_isolation`, `site_write_assigned` and
  `site_update_assigned` on `public.site_visits`, `public.site_photos`,
  `public.site_material_receipts` and `public.site_notes`, in that order;
  then EIGHT new ones, once only, one per new trigger:
  `message: 'trigger "trg_project_assignments_revoke_final" for relation "public.project_assignments" does not exist, skipping',`
  and the same for `trg_site_devices_revoke_final` (`public.site_devices`),
  `trg_site_visits_guard` and `trg_site_visits_date` (`public.site_visits`),
  `trg_site_photos_guard` and `trg_site_photos_state` (`public.site_photos`),
  `trg_site_material_receipts_guard` (`public.site_material_receipts`) and
  `trg_site_notes_guard` (`public.site_notes`).
  A second `db:apply-rls` prints only the first four.

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure (after one, npm adds `npm error` lines of its own; they only repeat
that the command failed). Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (65).
- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on `65 tables, 80 policies, 27 triggers, 59 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `— design_engagements update narrowed to 19 columns with no table-level update, and 23 narrowed table(s) (boqs, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, project_assignments, site_devices, site_location_consents, site_material_receipts, site_notes, site_photos, site_visits, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  If that second line is replaced by a problem list naming a policy the
  manifest does not declare, or a TRUNCATE, REFERENCES or TRIGGER grant, it
  exits 1: something was added by hand. Do not merge; tell the lead.
- `assert-schema-applied` exits 0 and prints six lines, in this order:
  `assert-schema-applied: OK — 65 declared table(s), every column present.`,
  then `assert-schema-applied: indexes — 147 declared, all present.`,
  `assert-schema-applied: constraints — 399 declared, all present.`,
  `assert-schema-applied: functions — 59 declared, all present.`,
  `assert-schema-applied: orphaned org rows — 57 org-scoped table(s) answered, none holds a row whose org_id names no organization.`
  and `assert-schema-applied: composite set-null FKs — 16 found (16 declared in src/schema/), every one narrowed to a single non-org_id column.`
  (The middle four are report only and do not fail it.)

**A lock race in `db:apply-rls` is retried for you.** A line like
`apply-rls: policies/00-core.sql rolled back with SQLSTATE 40P01 on attempt 1 of 3 (a lock race with live traffic); trying it again in 2 s.`
followed by `Applying policies/00-core.sql ... (attempt 2 of 3)` is NOT a
failure: that one file rolled back whole and is being applied again (3
attempts, 2 s then 4 s apart). Carry on reading the output.

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: 0064: could not take every lock within 3 s (stopped at public.projects:ACCESS EXCLUSIVE)`
  (the table named may be `contracts`, `contract_lines` or `organizations`)
  then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  The migration takes its four locks ALL OR NONE (see *Locks*): it tries for
  all four at once, lets go of every one it got when one table is busy, and
  tries again, for 3 s in all. This line means the named table never came
  free in those 3 s: a long query or transaction held it, or studio requests
  kept it busy without a gap. It held nothing while it tried, so no studio
  request waited on it. Re-run `db:migrate` a little later. Rehearsed: a
  reader holding `projects` for 10 s gave exactly these two lines, `migrations`
  stayed 64, step 2 (b) still read all 0, and the re-run after the reader
  finished applied 0064. A `SQLSTATE 40P01: deadlock detected` from
  `db:migrate` no longer comes from these locks (rehearsed: 0 in 60
  migration runs, 50 of them beside studio traffic); if one appears anyway, the same two lines and
  the same advice hold.
- `apply-rls failed: SQLSTATE 40P01: deadlock detected` (or
  `SQLSTATE 55P03: canceling statement due to lock timeout`) then
  `apply-rls failed: lock wait or deadlock, safe to re-run at a quieter moment (this file rolled back; the files before it stay applied).`
  That means the same file lost three times in a row. The cause is NOT a
  broken database, and usually not a long transaction either: a 40P01, almost
  always at `Applying policies/00-core.sql ...`, is ORDINARY studio traffic
  (that file locks the studios table and then the members table, and every
  studio save takes the two the other way round; a studio member may see one
  save fail and try it again); a 55P03 is a studio transaction or report that
  held a table for more than 3 s. **Run `npm run db:apply-rls` again, and keep
  re-running it until it exits 0** (wait a minute between runs; it is safe,
  every statement is idempotent). Until it does, the seven new tables are
  forced but may have no policy yet: `metra_app` reads and writes NOTHING in
  them (0064 itself forced their RLS), they are empty, and nothing reads
  them; still, re-run the same evening. Rehearsed: see *Rehearsed* below.
- `Migration failed: SQLSTATE 42701: column "site_lat" of relation "projects" already exists`
  (or `42P07` or `42710`, "already exists", for a table, a type or a
  function) then
  `Migration failed: tell the lead before running anything else (the whole batch rolled back, nothing was changed).`:
  part of the site diary is already in this database, which step 2 (b) would
  have shown. Nothing changed; tell the lead.
- `Migration failed: SQLSTATE P0001: 0064: ... composite set-null foreign
  key(s) ...`: a foreign key the 0052 rule forbids. Nothing changed; tell the
  lead.
- Any other code ends `tell the lead before running anything else`.

**Safe to re-run.** `db:migrate` records 0064 only when the whole batch
commits, so after any failure a re-run starts again from 0063; after a
success it finds nothing pending and prints `Migrations applied.` again
(rehearsed). Every statement under `rls/` is idempotent: a second
`db:apply-rls` prints the same two verified lines and only the first four
notices (rehearsed). `assert-schema-applied` only reads.

**Locks.** `db:migrate` runs 0064 as ONE transaction. It first takes every
lock it needs, ALL OR NONE, within ONE 3 s budget for all its attempts
together: ACCESS EXCLUSIVE (no reads, no writes) on `projects` and
`contracts`, and SHARE ROW EXCLUSIVE (reads go on, writes wait) on
`contract_lines` and `organizations`. Each attempt asks for all four without
waiting; if one is busy it lets go of the ones it got, sleeps 10 to 40 ms and
tries again, so it never holds `projects` while it waits for `contracts` (that
wait, against the contracts list, which reads `contracts` and then
`projects`, is what could deadlock before). Then, holding them, it adds five
empty columns to `projects` (no rewrite), checks the two new CHECKs over every
project (one scan each), builds one unique index over `contracts`, and creates
the seven empty tables. `projects` is read by nearly every studio page, so
those pages wait for this window, briefly: the whole migration took 120 to 139 ms at 5,002 projects and 5,002 contracts on a quiet local server and 150 to 390 ms beside studio traffic, and through a real `db:migrate` beside studio traffic the slowest studio request took 318 ms, with 0 errors. Supabase is slower than a local server (the window measured there earlier was 0.5 to 1.9 s), so a studio page can wait about 1 s; no studio request fails because of it. Under very dense traffic (about 3,000 requests a second in the rehearsal, far above any pilot) the all-or-none attempt kept losing and ended in the 55P03 above: the re-run case. Step 2 (c) gives the
sizes to compare with; pilot volumes are far below 5,000.
`design_engagements` (the table every client act locks) is not touched.
Estimates from a local server, not a production measurement. `db:apply-rls`
adds one policy file with seven NEW tables (nothing waits on them) and one
trigger in `policies/10-catalogue.sql`, which already locks `projects` for its
policy; every existing file runs exactly as it always does (the 11 x 3 s =
33 s worst case of `10-catalogue.sql` is unchanged), and a file that loses a
lock race is tried again (above).

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) `migrations` 65 and `newest` 1792880198159 (0064's journal stamp): step 2
(a) again.

(b) Step 2 (b) again: now `pin_columns` 5, `contract_project_key` 1,
`site_tables` 7, `site_types` 5, `site_functions` 13 and `pin_trigger` 1.

(c) 7 rows, every one with `rls` true, `forced` true, `app_privileges`
exactly `S,I,U` and `api_roles_read` false; `policies` 4 and `triggers` 1 on
`site_devices`; `policies` 3 and `triggers` 0 on `site_location_consents`;
`policies` 3 and `triggers` 1 on `project_assignments`,
`site_material_receipts` and `site_notes`; `policies` 3 and `triggers` 2 on
`site_photos` and `site_visits`.

```sql
-- Site diary step S 4 (c): the seven tables' RLS, grants and triggers. Run this one alone.
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       concat_ws(',',
         case when has_table_privilege('metra_app', c.oid, 'select') then 'S' end,
         case when has_table_privilege('metra_app', c.oid, 'insert') then 'I' end,
         case when has_table_privilege('metra_app', c.oid, 'update') then 'U' end,
         case when has_table_privilege('metra_app', c.oid, 'delete') then 'D' end) as app_privileges,
       coalesce((select bool_or(has_table_privilege(r.oid, c.oid, 'select')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated')), false) as api_roles_read,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('project_assignments', 'site_location_consents', 'site_devices', 'site_visits', 'site_photos', 'site_material_receipts', 'site_notes')
order by 1;
```

(d) Step 2 (d) again: now `policies` 80 and `restrictive` 15.

(e) Step 2 (c) again: the same two numbers as before.

(f) The four new definer functions: 4 rows, every one with `definer` true,
`app_execute` true, `public_execute` false and `api_roles_execute` false.

```sql
-- Site diary step S 4 (f): who may call the four new definer functions. Run this one alone.
select p.proname, p.prosecdef as definer,
       has_function_privilege('metra_app', p.oid, 'execute') as app_execute,
       exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute,
       coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated', 'service_role')), false) as api_roles_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_current_user_orgs_for_session', 'app_delivery_site_updates_by_token', 'app_may_manage_site_project', 'app_may_write_site_project')
order by 1;
```

(g) Nothing is written yet: `site_rows` 0 and `pinned_projects` 0.

```sql
-- Site diary step S 4 (g): no site row exists yet, and no project has a pin. Run this one alone.
select (select count(*) from public.project_assignments) + (select count(*) from public.site_location_consents)
     + (select count(*) from public.site_devices) + (select count(*) from public.site_visits)
     + (select count(*) from public.site_photos) + (select count(*) from public.site_material_receipts)
     + (select count(*) from public.site_notes) as site_rows,
       (select count(*) from public.projects where site_lat is not null) as pinned_projects;
```

(h) Step 2 (e) again: about the same size as before (the new tables are
empty; the rehearsal grew by about 1 MB, 50 MB to 51 MB, for the new unique key on `contracts`). Put the number in the
release note. **The size to watch:** Supabase Free stops writes at 500 MB, and
the site diary is the first thing that will fill it (about 0.19 MB a month
per active site, measured: see *Database size* below). **If this reads 400 MB
or more, tell the lead before PR S4 ships**; that 400 MB alarm is a later PR's
job, this line is the check until then.

**Stop and do not go on** if any output in steps 3 or 4 differs from what
is written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still
runs the current `main`; this checks it against the database step 3 just
changed. About ten minutes, in your own studio only. Open the log first, in
a second window, and leave it open:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

Then, signed in to your own studio:

1. **Page loads.** Open the dashboard, **Projects** and one project (each of
   its tabs), Clients and one client, then **Contracts** in the sidebar and
   one contract. Expected: every page loads and shows your data as before. A
   list that is suddenly EMPTY counts as a failure too.
2. **One harmless save.** Pick one of your own clients, open its **Details**
   tab, add a word at the end of **Notes** (for example `check`), press
   **Save details**: expected `Details saved`. Then delete that word, press
   **Save details** again: expected `Details saved`. In Arabic the same
   labels read التفاصيل, ملاحظات, حفظ التفاصيل and تم حفظ التفاصيل. Reload the page: Notes
   read exactly as before.

Expected in the log for all of the above: no `42501`, no `42703`, no
`MT100`, no `mutateInOrg failed`.

**If anything in step 5 fails:** do not merge. Run undo (0) below now, then
tell the lead what you saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (within the hour, see THE ORDER).
2. Smoke test on your own studio, the log still open: the page loads of step
   5 (1) again, now on the new code. Expected: every page loads, and the log
   shows no `42703`, no `42501` and no `mutateInOrg failed`.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(0) The policies and the pin trigger, before the merge** (step 5 fails, or
before the merge the log shows a `42501`). Step 3 changed no existing policy,
function or grant, and added one trigger on `projects` that the current code
never fires (rehearsed: identical catalogues otherwise), so this is a
precaution, not a repair. It takes the twenty-two new site policies away (the
seven tables stay forced, so with no policy `metra_app` reads and writes
nothing in them), drops the pin trigger, and runs the PREVIOUS `main`'s own
`db:apply-rls` (the code at `0f9cb2db`, the one the site runs now), which
re-applies every existing object exactly as it was before step 3. The
policies must go first: that code does not declare them, and its own check
refuses a policy it does not declare. It leaves 0064 itself alone: the new
columns, the seven tables with their grants and guard triggers, and the new
functions stay as step 3 made them (the current site never touches them).
Use it only while the site still runs the code from before the merge: if the
new code is already deployed, undo (1) the code first, then this.

First, in the Supabase SQL editor, on its own. Expected: one row,
`site_policies` 0 and `pin_trigger` 0.

```sql
-- Site diary step S undo (0): take the twenty-two site policies and the pin trigger away so the
-- previous main's apply-rls (which does not declare them) exits 0. Run this one alone.
begin;
drop policy if exists org_isolation on public.project_assignments;
drop policy if exists site_managers_insert on public.project_assignments;
drop policy if exists site_managers_update on public.project_assignments;
drop policy if exists org_isolation on public.site_location_consents;
drop policy if exists site_consent_self_insert on public.site_location_consents;
drop policy if exists site_consent_self_update on public.site_location_consents;
drop policy if exists org_isolation on public.site_devices;
drop policy if exists site_device_self_insert on public.site_devices;
drop policy if exists site_device_self_or_manager_select on public.site_devices;
drop policy if exists site_device_self_or_manager_update on public.site_devices;
drop policy if exists org_isolation on public.site_visits;
drop policy if exists site_write_assigned on public.site_visits;
drop policy if exists site_update_assigned on public.site_visits;
drop policy if exists org_isolation on public.site_photos;
drop policy if exists site_write_assigned on public.site_photos;
drop policy if exists site_update_assigned on public.site_photos;
drop policy if exists org_isolation on public.site_material_receipts;
drop policy if exists site_write_assigned on public.site_material_receipts;
drop policy if exists site_update_assigned on public.site_material_receipts;
drop policy if exists org_isolation on public.site_notes;
drop policy if exists site_write_assigned on public.site_notes;
drop policy if exists site_update_assigned on public.site_notes;
drop trigger if exists trg_projects_site_pin_writer on public.projects;
commit;
select (select count(*) from pg_policies
         where schemaname = 'public'
           and tablename in ('project_assignments', 'site_location_consents', 'site_devices', 'site_visits', 'site_photos', 'site_material_receipts', 'site_notes')) as site_policies,
       (select count(*) from pg_trigger where tgname = 'trg_projects_site_pin_writer') as pin_trigger;
```

The checkout you switch to below does not contain this runbook, so first
save a copy and read the rest of undo (0) from that copy:

```powershell
cd C:\Users\HP\merta-main
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-site-s.md
git fetch origin
git switch --detach 0f9cb2db
git log --oneline -1    # 0f9cb2db fix(ui): draw combobox and picker popups in a body-level layer
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout: the previous code does not know
0064, and nothing else is needed. Expected:

- It exits 0. NOTICE blocks: only the FIRST FOUR of step 3, nothing about the
  seven new tables or the pin trigger.
- It ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on
  `58 tables, 58 policies, 18 triggers, 47 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `— design_engagements update narrowed to 19 columns with no table-level update, and 16 narrowed table(s) (boqs, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  The numbers are smaller than step 3's on purpose: the previous code counts
  only what it declares.
- A failure prints `apply-rls failed: ...` with the SQLSTATE, as in step 3.
  The previous code does not retry a lost lock race by itself: on 55P03 or
  40P01, run it again a little later, until it exits 0. A problem list naming
  a `site_` policy means the SQL block above was not run first: run it, then
  this again.

Then, read-only (each block ON ITS OWN): step 2 (d) again, `policies` 58 and
`restrictive` 0; step 4 (c) again, exactly as step 4 (c) expects except
`policies` 0 on all seven rows; step 4 (f) again, exactly as step 4 (f)
expects. Then step 5 again: everything works as it did before step 3. Put
the checkout back on main (step 6 (3)) and tell the lead what failed the
first time. Do not merge. If step 5 STILL fails after undo (0), this step
was not the cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then
from step 3 only `npm run db:apply-rls` (0064 is still applied, so
`db:migrate` is not needed). Expected: the first four notices of step 3, then the pin trigger's and the twenty-two policy notices (the eight site trigger notices do not come back: those triggers were never removed) and the same two
verified lines; then step 4 (b) `pin_trigger` 1, step 4 (d) `policies` 80 and
`restrictive` 15, then step 5 and on.

**(1) The code** (a page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**(2) The schema, only if the site app is abandoned, and only while no site
row exists (step 4 (g) still 0 and 0).** Tell the lead first: it is a revert
of `rls/` and a new migration, never a hand edit here.

**Database size.** Measured on the rehearsal database: one year of the site
diary at the planned pilot scale (20 studios with 3 active sites each, 60
sites; per site per working day 1.5 visits, 10 photos, 3 deliveries and 2
notes; 264 working days), inserted with every trigger on, then vacuumed:

| Table | Rows a year | Bytes a row, indexes included | Size |
|---|---|---|---|
| `site_photos` (six indexes) | 158,400 | 523 | 79 MB |
| `site_material_receipts` | 47,520 | 518 | 23 MB |
| `site_notes` | 31,680 | 684 | 21 MB |
| `site_visits` | 23,760 | 713 | 16 MB |
| the site diary | | | about 140 MB a year, 0.19 MB a month per active site |

That is a lower bound (an update leaves dead space until autovacuum reclaims
it). At five times that scale it is about 700 MB a year, about 58 MB a month.
From the about 225 MB the database held earlier, 400 MB is reached after about
15 months at the planned scale (about 3 months at five times it) and 500 MB
after about 24 months (about 5). Hence step 4 (h).

**Rehearsed** on a local Postgres 17 (UTF8) built by the 0063 code (`main`'s
database code, `0f9cb2db`), with 5,002 projects, 5,002 contracts and 50,002
contract lines in 22 studios on it, then this branch's code: every command and
read-only block above printed exactly the lines quoted, on the first run and on
the second (`db:migrate` found nothing pending; `db:apply-rls` printed only the
first four notices). A catalogue fingerprint (every policy, function body and
settings, trigger definition and table grant) was identical before and after
step 3 for every object that existed before it, and an md5 of every existing
project and contract row was unchanged. The lock races, on purpose:

- a reader holding `projects` for 10 s against `db:migrate`: the two 55P03
  lines after 5.2 s, `migrations` still 64, step 2 (b) still all 0, and the
  re-run after the reader finished applied 0064;
- a reader holding `site_notes` for 25 s against `db:apply-rls`: two retries,
  then the two `apply-rls failed:` lines after 17.2 s; in between, the seven
  tables were forced with no policy and an insert by `metra_app` was refused
  (42501); the re-run exited 0;
- the traffic runs below were measured on the code before the S2 re-check
  round; 0064 and the apply-rls retry are byte-identical since, and that round
  changed only the new site tables' policies and guards, which no studio
  request touches;
- 30 migration runs (rolled back) beside studio traffic at about 13 requests a
  second, the contracts list among them: 30 of 30 clean, 0 deadlocks, the
  slowest studio request 220 ms (the earlier one-lock-at-a-time version
  deadlocked in 3 to 10 % of such runs); 10 at about 520 requests a second: 10
  of 10, 0 deadlocks; 10 at about 3,000 a second: 9 ended in 55P03, 1 clean,
  0 deadlocks, 0 studio errors;
- a real `db:migrate` beside studio traffic: applied in 2.4 s, 0 studio errors,
  the slowest studio request 318 ms;
- six `db:apply-rls` runs beside about 830 studio writes a second: all six
  exited 0; five lost a race at `policies/00-core.sql` (40P01), and each landed
  on its retry; 24 of the studio writes were ended by the same deadlocks
  instead (a studio member would see one save fail), which is why step 3 asks
  for a quiet hour.

On that 0064 database the current `main`'s own cross-tenant isolation gate
passed (59 of 59), and its action tests passed 1,469 of 1,472 (one is a
todo): the other two only count schema objects (the set-null foreign keys and
the token functions in the database) and count the ones 0064 adds on any 0064
database. Undo (0) printed exactly the lines above and exited 0; the
fingerprint then matched the database before step 3 for every object the
previous `main` declares, plus the 28 objects of 0064 it keeps (thirteen
functions, the seven tables, the eight triggers on them), and matched step 3's
database minus the twenty-two policies and the pin trigger. Without the SQL
block first, the previous `main`'s `db:apply-rls` exits 1 and lists 22
problems, each a site policy "declared by NO rls/ file". This branch's
`db:apply-rls` afterwards printed the lines of *To go forward again* and gave
a database identical to the first run's.

### Stage 2 DB step B (the client "I paid" on the delivery page): owner runbook

The second Stage 2 database step. It is `db:apply-rls` ONLY: no migration, so
`db:migrate` is not part of it. It runs AFTER the site diary's DB step S
(0064, the section above): production then holds 65 migrations, and step B
leaves it at 65. It is validated on branch `validate/release-b4`, whose code
is pinned at **`4cf2a68a`**: the branch's last code commit (every commit after
it changes only `docs/DEPLOY.md`). That branch carries `main`, the site diary's
database code exactly as step S applied it (the step S pin `992bca1e`), and
B4. It must carry the site diary's code: after step S the database holds the
site diary's 22 policies, and `db:apply-rls` refuses to finish on a database
holding a policy its own code does not declare.

**Step B is NOT the last database step.** These were asked for in the plan's
"DB step B" addenda and are NOT in it; they wait for a later step that carries
a migration (0066 or later: 0065 is the client home's, below), with its own
runbook, and the owner has not yet decided when:

- the stored folded search columns on contract lines, section titles and the
  price book (`contract_lines.search_text` and its kin), which make a search
  on a very long contract cheap (the per-member read throttle is the backstop
  until then);
- the stored name comparison form on price-book items (`name_ar_form`,
  `name_en_form`) and its index, for the market "add to my price book" name
  check;
- payment reversal (undoing a recorded payment), which has no design yet;
- optionally, the contract lines index for one very large section, and the
  contract link's digest stored at issue (both only if measurements ask).

**THE ORDER (do not change it):**

0. **Two things must already be done.** The site diary's **DB step S** (the
   section above), run from its pin `992bca1e`, with its step 4 as expected;
   and **PR A3 deployed** (the contract link /c opening long contracts section
   by section and loading the rest on request), which is on `main` since the
   Stage 2 A3 merge. Step 1 checks both from the code; check yourself that you
   ran step S from `992bca1e`.
1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge. If it fails, undo (0) puts the previous database
   code back.
3. **Then, right after that check,** the lead merges the branch to `main`, the
   Deploy workflow deploys it, and you run the smoke test (step 6). Do not leave
   a gap: merge within the hour (see the second reason below).

Why this order, one sentence each:

- **The new code needs the new database code:** the delivery page's new
  execution card and the client's "I paid" call two new client functions, and
  the contract link's "show more sections" calls a third; on the old database
  code the card does not show and "show more sections" fails.
- **The current Worker is safe on it, with ONE visible difference while it
  waits for the merge:** the contract link's first answer now carries only its
  first 50 sections (and, between them, the contract's first 50 lines). The
  current page already opens on exactly that, so a client sees the same page;
  but on a contract with MORE than 50 sections, the current page counts the
  sections it was sent, so it shows the first 50 and offers no "show more
  sections" at all: nothing tells that client more exist until this branch is
  deployed. Every other change only adds, or refuses a write the current code
  never makes (rehearsed: see *Rehearsed* for the current code's own action
  tests on the new database).
- **A client "I paid" on a payment request now also writes studio
  notifications** ("The client says they paid payment request PR-2026-0004").
  The current Worker shows an unknown notification as an empty line, never as
  an error, which is the second reason the merge follows step 5 at once. No
  client can send one before the merge: only the new page has the button.

Whether the site diary's branch is already merged to `main` makes no
difference to this step: this branch carries that code either way, and if it
is not merged yet, merging this branch merges it too (it needs only 0064,
which step S applied).

**What it changes.** No row is written, updated or deleted. Nothing is
backfilled. Nothing of the site diary changes (rehearsed: every site policy,
function, trigger and grant identical before and after step 3).

| Object | Change |
|---|---|
| `rls/functions/70-execution-portal.sql` (new) | the delivery page's execution card (`app_delivery_execution_by_token`: the execution contract, its newest 60 payment requests with what is paid and due on each, the newest 60 payments received (same-day ones newest first), the client's notices still waiting on an earlier contract of the delivery, and the studio's payment details only while something is due) and the client's "I paid" on one request (`app_delivery_claim_request_by_token`: claims what is still due, the client sends no amount; tells owners, admins and accountants in the same transaction; at most 10 claims per contract per hour; waits at most 4 s on a busy request; never waits on the delivery row), plus two internal helpers nobody else may call |
| `rls/functions/30-contracts-variations.sql` | the contract link's first answer carries its first 50 sections and, between them, the first 50 lines of the WHOLE contract, plus how many sections it has; a new function serves the sections after the first 50, 50 at a time; the digest the client's acknowledgement covers now also covers every section's title and subtotal. The change-order link (/v) adds the contract's end date and its approved extra days, and a client's approve or reject now waits for a termination in flight (at most 4 s, as the other client answers) and is refused on the terminated contract |
| `rls/functions/35-execution.sql`, `rls/policies/35-execution.sql` | four new trigger functions and eight triggers: a cost entry never moves to another contract, and a voided one is final; a client's claim keeps what the client sent and is answered once; a site measurement goes only on a signed execution contract with no final account, on a day from its issue to tomorrow; and the member a payment request, a payment, a void, a cost entry, a claim's answer or a measurement names as its author must be the member who is signed in |
| `rls/roles.sql` | `metra_app` may update only the 15 columns a cost edit or void writes (it could update every column before); on the client's claims it may no longer insert (only the client's link function writes one) and may update only the 5 columns of the studio's answer; the new functions are callable by `metra_app` only, the two helpers by nobody |
| `packages/db/src/scripts/apply-rls.ts` | unchanged since step S: a file that loses a lock race with live traffic (40P01 or 55P03) is tried again, up to 3 times, with a line saying so (step 3) |

**1. Put the step B code in the production checkout.** This step adds no
dependency of `db:apply-rls`, so the installed `node_modules` serve as they
are. Right after the switch it saves a copy of this runbook: the checkout
undo (0) switches to does not contain this section.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/release-b4
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-step-b.md
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 4cf2a68a HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (4cf2a68a)
git log --oneline HEAD..origin/main -- packages/db    # MUST print nothing: every database change on main is already in this code
git diff --stat 992bca1e HEAD -- packages/db/migrations    # MUST print nothing: the migrations are exactly step S's, 0064 the newest
git show origin/main:apps/web/src/lib/contracts/public.ts | Select-String -SimpleMatch "app_contract_section_lines_by_token"    # MUST print a line: A3 is on main
```

The `Copy-Item` line saves this runbook (the branch's, which has this section)
to your Desktop; read the rest of it from that copy (undo (0) needs it). Five
STOPs, tell the lead in each case:

- The `git diff --stat 4cf2a68a HEAD` lists any file other than
  `docs/DEPLOY.md`: the code is not the code that was rehearsed.
- The `git log ... -- packages/db` prints any line: database code reached
  `main` after this branch was last brought up to date, and this branch's
  `db:apply-rls` would take it away again.
- The migrations diff prints anything: the migrations differ from step S's,
  and this runbook covers none.
- The last command prints nothing: PR A3 is not on `main` (step 0).
- You ran step S from a pin other than `992bca1e`, or have not run it: undo
  (0) below would not put back what production runs on.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the LAST
result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 65 and `newest` 1792880198159 (0064's journal stamp:
step S is in). Anything else: STOP, tell the lead.

```sql
-- Step B step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** every column 0. Anything else
means part of step B is already in this database: do not run step 3, tell the
lead.

```sql
-- Step B step 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_delivery_execution_by_token', 'app_delivery_claim_request_by_token',
                        'app_delivery_execution_contract', 'app_studio_payment_details',
                        'app_contract_sections_by_token', 'enforce_actor_is_session_user',
                        'enforce_cost_entry_guarded', 'enforce_contract_payment_claim_guarded',
                        'enforce_contract_line_measurement_guarded')) as step_b_functions,
  (select count(*) from pg_trigger t
    where not t.tgisinternal
      and t.tgname in ('trg_payment_requests_actor', 'trg_contract_payments_actor',
                       'trg_contract_cost_entries_actor', 'trg_contract_cost_entries_guarded',
                       'trg_contract_payment_claims_actor', 'trg_contract_payment_claims_guarded',
                       'trg_contract_line_measurements_actor', 'trg_contract_line_measurements_guarded')) as step_b_triggers,
  (select count(*) from public.contract_payment_claims) as client_claims;
```

(c) The sizes. Note the five numbers; step 4 (e) expects the same.

```sql
-- Step B step 2 (c): the execution tables' sizes. Run this one alone.
select (select count(*) from public.payment_requests) as payment_requests,
       (select count(*) from public.contract_payments) as contract_payments,
       (select count(*) from public.contract_cost_entries) as cost_entries,
       (select count(*) from public.contracts where status in ('issued', 'signed')) as contracts_with_a_link,
       (select coalesce(max(n), 0) from (select count(*) as n from public.contract_sections group by contract_id) per_contract) as most_sections_in_one_contract;
```

If `most_sections_in_one_contract` is more than 50, that contract is the one
the first reason under THE ORDER is about: merge at once after step 5.

(d) The six execution tables' grants and triggers, before. Expect exactly:
`contract_cost_entries` S,I,U / 21 / 0; `contract_line_measurements` S / 0 / 0;
`contract_payment_claims` S,I,U / 15 / 0; `contract_payment_milestones`
S,I,U,D / 10 / 1; `contract_payments` S,I / 0 / 1; `payment_requests` S,I,U /
18 / 1 (privileges / updatable columns / triggers). Step 4 (b) runs it again.

```sql
-- Step B step 2 (d): the six tables' grants and triggers. Run this one alone.
select c.relname,
       concat_ws(',',
         case when has_table_privilege('metra_app', c.oid, 'select') then 'S' end,
         case when has_table_privilege('metra_app', c.oid, 'insert') then 'I' end,
         case when has_table_privilege('metra_app', c.oid, 'update') then 'U' end,
         case when has_table_privilege('metra_app', c.oid, 'delete') then 'D' end) as app_privileges,
       (select count(*) from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('metra_app', c.oid, a.attnum, 'update')) as updatable_columns,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('contract_payment_milestones', 'payment_requests', 'contract_payments', 'contract_payment_claims', 'contract_cost_entries', 'contract_line_measurements')
order by 1;
```

(e) Step S's policies are in. Expect `policies` 80 and `restrictive` 15
(the numbers step S's step 4 (d) gave). Step B adds no policy: step 4 (f)
expects the same.

```sql
-- Step B step 2 (e): the policies, and how many are restrictive. Run this one alone.
select count(*) as policies,
       count(*) filter (where permissive = 'RESTRICTIVE') as restrictive
from pg_policies where schemaname = 'public';
```

**3. Apply RLS, then prove it landed.** From `C:\Users\HP\merta-main` (its
`.env` is the production connection), **at a quiet hour** (late evening, when
no studio is working; see below). NOT `db:migrate`: step B has no migration.

```powershell
npm run db:apply-rls
npm run assert-schema-applied -w @metra/db
```

**NOTICE blocks are normal.** `db:apply-rls` prints routine NOTICE blocks with
a `message:` line; on Supabase a line about a role may differ, and any line
that ends `does not exist, skipping` or `already exists, skipping` is the same
kind. In this order: the same first four as every run
(`message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`,
then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`,
then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`,
then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`),
then EIGHT new ones, once only:
`message: 'trigger "trg_contract_cost_entries_guarded" for relation "public.contract_cost_entries" does not exist, skipping',`,
`message: 'trigger "trg_payment_requests_actor" for relation "public.payment_requests" does not exist, skipping',`,
`message: 'trigger "trg_contract_payments_actor" for relation "public.contract_payments" does not exist, skipping',`,
`message: 'trigger "trg_contract_cost_entries_actor" for relation "public.contract_cost_entries" does not exist, skipping',`,
`message: 'trigger "trg_contract_payment_claims_actor" for relation "public.contract_payment_claims" does not exist, skipping',`,
`message: 'trigger "trg_contract_payment_claims_guarded" for relation "public.contract_payment_claims" does not exist, skipping',`,
`message: 'trigger "trg_contract_line_measurements_actor" for relation "public.contract_line_measurements" does not exist, skipping',`
and `message: 'trigger "trg_contract_line_measurements_guarded" for relation "public.contract_line_measurements" does not exist, skipping',`.
Nothing about a site table: step S's objects are re-applied exactly as they
are. A second `db:apply-rls` prints only the first four.

Only a line that starts `apply-rls failed:` is a failure (after one, npm adds
`npm error` lines of its own; they only repeat that the command failed).
Expected:

- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on
  `65 tables, 80 policies, 35 triggers, 68 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 23 narrowed table(s) (boqs, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, project_assignments, site_devices, site_location_consents, site_material_receipts, site_notes, site_photos, site_visits, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; contract_cost_entries updatable on its 15 entry and void columns only; contract_payment_claims updatable on its 5 answer columns only; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  If that second line is replaced by a problem list, it exits 1: something
  was added by hand (or step S is missing). Do not merge; tell the lead.
- `assert-schema-applied` exits 0 and prints six lines, in this order:
  `assert-schema-applied: OK — 65 declared table(s), every column present.`,
  then `indexes — 147 declared, all present.`, `constraints — 399 declared, all present.`,
  `functions — 68 declared, all present.`,
  `orphaned org rows — 57 org-scoped table(s) answered, none holds a row whose org_id names no organization.`
  and `composite set-null FKs — 16 found (16 declared in src/schema/), every one narrowed to a single non-org_id column.`

**Run it at a quiet hour** (late evening, when no studio is working): ordinary
traffic is enough to make a file lose a lock race, see below.

**A lock race is retried for you.** A line like
`apply-rls: policies/00-core.sql rolled back with SQLSTATE 40P01 on attempt 1 of 3 (a lock race with live traffic); trying it again in 2 s.`
followed by `Applying policies/00-core.sql ... (attempt 2 of 3)` is NOT a
failure: that one file rolled back whole and is being applied again. Carry on
reading the output.

**If it fails, it prints the SQLSTATE and what to do,** on two lines:
`apply-rls failed: SQLSTATE 40P01: deadlock detected`
(or `SQLSTATE 55P03: canceling statement due to lock timeout`) then
`apply-rls failed: lock wait or deadlock, safe to re-run at a quieter moment (this file rolled back; the files before it stay applied).`
That means the same file lost three times in a row. The cause is NOT a broken
database, and usually not a long transaction either:

- **40P01, almost always at `Applying policies/00-core.sql ...`** (or
  `policies/40-engagements.sql`): ORDINARY app traffic. That file locks the
  studios table and then the members table; every studio save takes the two
  the other way round (members first, for the "is this a member" check, then
  the studio, for the row's studio link). Two sub-second transactions in
  opposite orders are a deadlock, and Postgres ends one of them, sometimes the
  app's (a studio member may see one save fail and try it again; rarely a
  client's link fails to load once, and a refresh fixes it). Measured: 3 or
  more studio saves a second are enough, and at about 11 a second the three
  attempts can all lose, so the run fails and the next run lands it.
- **55P03, usually at `Applying policies/35-execution.sql ...`:** a long
  studio transaction or report held a table for more than 3 s.

Either way: **run `npm run db:apply-rls` again, and keep re-running it until it
exits 0** (wait a minute between runs; it is safe, every statement is
idempotent). A run that fails at `policies/00-core.sql` prints three notices
before its two failure lines (the `self_memberships` notice comes from that
file itself); a run that lands a file on a later attempt prints that file's
notices after its `(attempt 2 of 3)` line. The run that exits 0 prints the notices of the files the
failed run did not get past (the first four and all eight trigger notices if
it failed at `policies/35-execution.sql`) and the two lines above. In between,
step 2 (b) may show `step_b_functions` 9 and `step_b_triggers` 0, and step 2
(d) the new privileges and updatable columns with the old trigger counts (the
functions files and `roles.sql` ran, a policy file rolled back); the current
site works on that too. Rehearsed: see *Rehearsed* below. Any other code: tell
the lead before running anything else.

**Safe to re-run.** Every statement under `rls/` is idempotent: a second
`db:apply-rls` prints only the first four notices and the same two lines.
`assert-schema-applied` only reads.

**Locks.** Each policy file takes a table lock for an instant per table, and
waits at most 3 s for it (`MIGRATION_LOCK_TIMEOUT`); every file runs as one
transaction, so a file that loses rolls back whole and the script tries it
again (3 attempts, 2 s then 4 s apart). The eight new triggers are attached in
`policies/35-execution.sql`, on tables that now hold live rows, and every run
also re-applies `policies/00-core.sql` and `policies/40-engagements.sql` on the
busiest tables (and step S's `policies/70-site.sql`, on the seven site tables,
which nothing writes yet); while a file waits, the app's saves on those tables
wait behind it (measured: up to about 1.4 s instead of 0.3 s). That is the
reason for the quiet hour.

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) Step 2 (a) again: `migrations` still 65, `newest` still 1792880198159.

(b) Step 2 (b) again: now `step_b_functions` 9, `step_b_triggers` 8,
`client_claims` the same as before (0 before the merge: only the new page has
the button). Then step 2 (d) again: now `contract_cost_entries` S,I / 15 / 2;
`contract_line_measurements` S / 0 / 2; `contract_payment_claims` S / 5 / 2;
`contract_payment_milestones` S,I,U,D / 10 / 1; `contract_payments` S,I / 0 /
2; `payment_requests` S,I,U / 18 / 2.

(c) Who may call the step B functions: 9 rows. `app_execute` true on the three
`app_*_by_token` functions and the four `enforce_*` trigger functions, false on
`app_delivery_execution_contract` and `app_studio_payment_details` (internal:
nobody calls them but the functions beside them); `public_execute` false and
`api_roles_execute` false on all nine.

```sql
-- Step B step 4 (c): who may call the step B functions. Run this one alone.
select p.proname,
       has_function_privilege('metra_app', p.oid, 'execute') as app_execute,
       exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute,
       coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated', 'service_role')), false) as api_roles_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_delivery_execution_by_token', 'app_delivery_claim_request_by_token',
                    'app_delivery_execution_contract', 'app_studio_payment_details',
                    'app_contract_sections_by_token', 'enforce_actor_is_session_user',
                    'enforce_cost_entry_guarded', 'enforce_contract_payment_claim_guarded',
                    'enforce_contract_line_measurement_guarded')
order by 1;
```

(d) The contract link's first answer, on every contract with a link: one row
each (at most 20), with `opening_sections` at most 50, `opening_lines` at most
50, and `section_count` the contract's real number of sections. It reads only
what a client's link reads.

```sql
-- Step B step 4 (d): what each contract link opens with now. Run this one alone.
select c.number,
       (d.snapshot ->> 'section_count')::int as section_count,
       jsonb_array_length(d.snapshot -> 'sections') as opening_sections,
       (select coalesce(sum(jsonb_array_length(s -> 'lines')), 0) from jsonb_array_elements(d.snapshot -> 'sections') s) as opening_lines
from public.contracts c
cross join lateral (select public.app_contract_by_token(c.token_hash) as snapshot) d
where c.token_hash is not null and c.status in ('issued', 'signed')
order by c.number desc
limit 20;
```

(e) Step 2 (c) again: the same five numbers as before.

(f) Step 2 (e) again: still `policies` 80 and `restrictive` 15.

**Stop and do not go on** if any output in steps 3 or 4 differs from what is
written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still runs
the current `main`. About ten minutes, in your own studio only. Open the log
first, in a second window, and leave it open:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

Then, signed in to your own studio:

1. **Page loads.** Open **Contracts** in the sidebar (العقود) and one contract,
   then, if it is an execution contract, its **Payments** tab (الدفعات), its
   costs page and its change-order tab. Then a delivery (التسليمات), a project
   and the price book. Expected: every page loads and shows your data as
   before. A list that is suddenly EMPTY counts as a failure too.
2. **The client links, only if you have a test one.** If a test project of
   yours has a contract link (`/c/...`) or a delivery link (`/d/...`) you sent
   to yourself, open each: it shows as before, and on the contract link "show
   lines" on a section still opens its lines. Only look: do not sign, approve or
   say you paid anything. No test link: skip this; do not create one for it.

Expected in the log for all of the above: no `42501`, no `42883`, no `MT100`,
no `MT140`, no `mutateInOrg failed`.

**If anything in step 5 fails:** do not merge. Run undo (0) below now, then
tell the lead what you saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (within the hour, see THE ORDER).
2. Smoke test on your own studio, the log still open: the page loads of step 5
   (1) again, now on the new code. If a test delivery of yours is at the
   execution stage and its contract is signed, open its delivery link: under
   the payments card there is a "Construction contract" card (عقد التنفيذ) with
   the contract's number. Only look. Expected in the log: no `42501`, no
   `42883`, no `MT140`, no `mutateInOrg failed`.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(0) The database code, before the merge** (step 5 fails, or before the merge
the log shows a `42501`, an `MT140` or a studio reports a broken page). Two
parts: the `db:apply-rls` of the code step S ran from (`992bca1e`: `main`'s
database code plus the site diary's, the database code production ran on just
before step 3), which puts back the contract link without the cap, the
change-order link without the two new keys and without the wait for a
termination, the cost entries' full UPDATE and the claims' insert and full
UPDATE; then one SQL block that removes what that code does not know (the
eight triggers and the nine functions). No SQL block is needed BEFORE that
`db:apply-rls` (the site diary's undo needs one, for its policies): step B adds
no policy, so that code's own check finds nothing it does not declare.
Afterwards the database is exactly as it was before step 3: rehearsed, a
catalogue comparison found zero differences. Use it only while the site still
runs the code from before the merge: if the new code is already deployed, undo
(1) the code first, then this. Any "I paid" a client sent in between stays
recorded as a pending claim (data, not code); tell the lead how many step 2 (b)
shows.

From the copy you saved in step 1:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach 992bca1e
git log --oneline -1    # 992bca1e S2 re-check fixes: an insert is asked what an update is, own rows, device and assignment identity
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout, at a quiet hour as in step 3.
Expected: it exits 0; only the FIRST FOUR notices of step 3; and it ends with
the two lines that code prints, the first going on
`65 tables, 80 policies, 27 triggers, 59 functions, RLS forced on all of them, role metra_app present.`
and the second the same as step 3's WITHOUT the two parts
`contract_cost_entries updatable on its 15 entry and void columns only; ` and
`contract_payment_claims updatable on its 5 answer columns only; `.

**If this `db:apply-rls` fails** with the two `apply-rls failed:` lines of step
3 (`SQLSTATE 40P01` or `55P03`), it is the same lock race with live traffic as
in step 3 (that code retries a file for you too, the same 3 attempts): **run
`npm run db:apply-rls` again from this checkout, and keep re-running it until it
exits 0.** Any other code: stop and tell the lead.

**Do not run the SQL block below until this `db:apply-rls` has exited 0.** The
block drops functions the step B triggers call; run before that code's files
have all landed, it can leave the database between the two versions.

Then, in the Supabase SQL editor, this block, on its own:

```sql
-- Step B undo (0), part 2: the objects the step S code does not know. Run this one alone.
set lock_timeout = '3s';
drop trigger if exists trg_payment_requests_actor on public.payment_requests;
drop trigger if exists trg_contract_payments_actor on public.contract_payments;
drop trigger if exists trg_contract_cost_entries_actor on public.contract_cost_entries;
drop trigger if exists trg_contract_cost_entries_guarded on public.contract_cost_entries;
drop trigger if exists trg_contract_payment_claims_actor on public.contract_payment_claims;
drop trigger if exists trg_contract_payment_claims_guarded on public.contract_payment_claims;
drop trigger if exists trg_contract_line_measurements_actor on public.contract_line_measurements;
drop trigger if exists trg_contract_line_measurements_guarded on public.contract_line_measurements;
drop function if exists public.app_delivery_claim_request_by_token(text, uuid, text, text, text, text);
drop function if exists public.app_delivery_execution_by_token(text);
drop function if exists public.app_delivery_execution_contract(uuid, uuid);
drop function if exists public.app_studio_payment_details(uuid);
drop function if exists public.app_contract_sections_by_token(text, integer);
drop function if exists public.enforce_actor_is_session_user();
drop function if exists public.enforce_cost_entry_guarded();
drop function if exists public.enforce_contract_payment_claim_guarded();
drop function if exists public.enforce_contract_line_measurement_guarded();
```

Expected: `Success. No rows returned`. Run it at the same quiet hour: each
`drop trigger` locks its table, and the first line makes the block give up
after 3 s instead of holding the money tables while a long report finishes.
If it fails with `canceling statement due to lock timeout`, nothing was
dropped (the editor runs the block as one transaction): run the same block
again a minute later, until it succeeds. Then, read-only, each block ON ITS OWN:
step 2 (b) again (`step_b_functions` 0, `step_b_triggers` 0), step 2 (d)
again (exactly what step 2 (d) expects) and step 2 (e) again (80 and 15).
Then step 5 again: everything works as it did before step 3. Put the checkout
back on main (step 6 (3)) and tell the lead what failed the first time. Do not
merge. If step 5 STILL fails after undo (0), the database code was not the
cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then step
3 (`npm run db:apply-rls`, whose first run prints the eight trigger notices
again; re-run it until it exits 0, as step 3 says), then step 4 and on.

**(1) The code** (a page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**Rehearsed** (B4 release, Oct 25) on a local PostgreSQL 17 database (UTF8)
built to production's shape: Supabase's API roles and default grants
simulated first; then `main`'s database code (`0f9cb2db`, 0063: `db:migrate`,
`db:apply-rls`, `seed`); 5,003 projects, 5,003 contracts and 50,542 contract
lines in 22 studios, a delivery at execution with a signed execution contract
of 121 sections (one of 300 lines), a part-paid payment request, a cost entry
and an approved change order of 15 days (no client claim, as in production);
then DB step S from `992bca1e` (`db:migrate`, `db:apply-rls`,
`assert-schema-applied`: 65 migrations, 80 policies). Every command and SQL
block above was then run as written, from a separate clone standing in for
`merta-main` (its own `npm ci`, `origin` on GitHub, `origin/main` at
`0f9cb2db`): the PowerShell from scripts made of this section's blocks with
three substitutions only (the checkout path, the Desktop path, and the
connection set in the session in place of `.env`), the SQL from the saved
copy.

- Steps 1 to 4 printed exactly what they say. Step 1's three guards printed
  nothing and the A3 line printed; step 3 printed the four notices, the eight
  trigger notices in the order listed, the two lines and the six
  `assert-schema-applied` lines; the second run printed only the four. An md5
  of every row of fifteen tables (projects, contracts with their sections and
  lines, the six execution tables, change orders, deliveries, notifications,
  members, studios) was identical before and after.
- A catalogue comparison (every policy, function body with its settings and
  grants, trigger, table and column grant, and the role) before and after step
  3 found exactly the changes under *What it changes*: 9 functions and 8
  triggers added; the contract link, the change-order link and the
  change-order answer replaced; the cost entries' UPDATE turned into 15 column
  grants and the claims' INSERT and UPDATE into 5; nothing else, so no site
  diary object changed.
- **The lock race, on purpose.** A reader holding `contract_cost_entries` for
  30 s while step 3 ran on the step B database: `policies/35-execution.sql`
  lost three times (55P03), and `apply-rls` exited 1 with the two failure lines
  after 19 s; the re-run after the reader ended exited 0, the catalogue
  unchanged.
- **Undo (0)**, from the saved copy: `992bca1e`'s `db:apply-rls` printed the
  four notices and the two lines quoted there and exited 0; the SQL block
  returned no rows; step 2 (b), (d) and (e) read as before step 3; and the
  catalogue was identical to the one before step 3 (zero differences).
- **Forward again**, with the same 30 s reader: the first run exited 1 as
  above, printing only the four notices before the failure lines; in between,
  step 2 (b) read 9, 0 and 0 and step 2 (d) the new privileges and columns with
  the old trigger counts; the re-run after the reader ended exited 0 with the
  four and the eight notices, and the catalogue was identical to the first
  forward's.
- The 40P01 figures under step 3 and *Locks* (3 or more studio saves a second;
  saves waiting about 1.4 s) come from the B4 fix round's rehearsal (Oct 20);
  the `apply-rls` retry is byte-identical since.
- **The current code on the step B database**, each run on a freshly applied
  step B (one action test file, `execution-schema.dbtest.ts`, re-runs its own
  checkout's `roles.sql` and so puts the old grants back for the files after
  it; it was run on its own). `main` plus the site diary (`992bca1e`, what
  `main` is once the site diary is merged): isolation gate 60 of 60, action
  tests 1,571 of 1,584 passed (one is a todo). `main` alone (`0f9cb2db`):
  isolation gate 59 of 59, action tests 1,458 of 1,472 passed (one todo). The
  12 failures common to both test what step B changes on purpose, and no app
  path: 4 test the uncapped contract link of step A (the visible difference
  under THE ORDER); 1 pins the list of client functions; 1 pins step A's
  grants on the six execution tables; 1 inserts a claim as `metra_app` (now
  only the client's link function may); 4 write site readings as `metra_app`
  that the new measurement guard refuses (dated before their test contract was
  issued, as the measurement screen already refuses them); and 1 fails the same
  way on the database before step 3 (it checks a Supabase default grant that
  this rehearsal's simulated roles add and `roles.sql` does not manage).
  `main` alone has one more, which counts the composite set-null foreign keys
  and fails on any database with 0064 (step S's runbook says so). No cost
  entry, payment, payment request, final account or measurement-screen test of
  the shipped code failed under the new guards and grants.

### Client home DB step C (0065, the client's one page): owner runbook

The client home's database step: migration `0065_client_home.sql` plus
`db:apply-rls` (two new files under `rls/functions/`, one under
`rls/policies/`, and changes to five existing files and `rls/roles.sql`). It
runs AFTER Stage 2 DB step B (the section above): production then holds 65
migrations and 80 policies, 15 of them restrictive; step C leaves it at 66
and 81. It is validated on branch `validate/home-h3-sql`, whose code is
pinned at **`31e21c8f`**: the branch's last code commit (every commit after it
changes only `docs/DEPLOY.md`). That branch is `main` (`65c78473`: Stage 2,
the site diary and step B) plus PR H3, its two fix rounds and the code cleanup of
`validate/cleanup-oct26` (`6ed20154`, no database change).

**Step C is not the last client home step.** DB step C2 (apply-rls only)
comes later, with the next scheduled database step after PR H7 is live: the
four old client acts (`app_contract_ack_by_token` and
`app_variation_respond_by_token` for BOQ contracts, and the two "I paid"
functions) will then answer `moved` unless a code was checked first. Its
runbook is written then; step C changes none of those four answers.

**THE ORDER (do not change it):**

0. **Already done:** Stage 2 **DB step B**, run from its pin `4cf2a68a` with
   its step 4 as expected (`main`'s `packages/db` is that code, byte for
   byte). Step 1 checks the code; check yourself that you ran step B.
1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge. If it fails, undo (0) puts the previous database
   code back.
3. **Then, right after that check,** the lead merges the branch to `main`, the
   Deploy workflow deploys it, and you run the smoke test (step 6).

Why this order, one sentence each:

- **The new code needs the new database code:** the delivery cockpit's
  execution card, the contract page's stage, the Payments tab, the final
  account and the payment request cores now read the execution facts through
  new database functions (one source the client home will share), and issuing
  a change order now restarts its client link's 30 days, which the old
  change-order guard refuses (MT100). On the old database those pages fail
  with 42883 and the issue with MT100.
- **The current Worker is safe on the new database, with no visible
  difference:** 0065 only adds (two columns with a default, two checks, one
  index, one empty table), and this `db:apply-rls` keeps every answer the
  current code gets. Five client functions are rewritten to share one helper
  each, and answer byte for byte what they did (rehearsed: an md5 of every
  contract link, change-order link, delivery link and execution card document
  identical before and after); the delivery link's answer gains one key,
  `entry_phase` (`design` for every delivery today), which the current code
  does not read (its mapper picks the keys it knows, and a test pins that);
  the change-order guard admits everything the old
  one did; a delivery's execution contract is now also found by its project
  for a "light" delivery, of which none exists until PR H4. One rule moves for
  the execution card and the "I paid" behind it: they now stand on the
  delivery's contract by the rule the studio's cockpit uses, so a delivery
  whose terminated contract a newer issued BOQ replaced, or whose BOQ was made
  for another client of the project, shows what its cockpit shows. Step 2 (g)
  counts those deliveries, and the BOQs made for another client; production
  should have none of either. Rehearsed: the
  current `main`'s own isolation gate and action tests on the step C database
  (see *Rehearsed*).
- **No client sees anything new** until PR H4: the new client functions have no
  caller in the current code, and the codes table stays empty.

**What it changes.** No existing row is updated and nothing is backfilled.

| Object | Change |
|---|---|
| `design_engagements` | one new column, `entry_phase` (`design` for every delivery, the default; `execution` for a LIGHT delivery, the client page of an execution contract with no design delivery behind it, created from PR H4), two checks (only those two values; a light delivery is at `execution` and stays there), and one unique index (at most one light delivery per project and client) |
| `variation_order_events` | one new column, `recorded_on_paper` (false for every event, the default; true, from PR H7, on a client's change-order decision the studio records from a paper document the client signed) |
| `client_verification_codes` (new, empty) | one row per one-time code a client asks for (from PR H5): which delivery, which act and which document, the HASH of the code (never the code), where it was sent (a hash and a hint of the address), the client's ip and browser, and what it was used for. Ten minutes of life and five tries, by check. RLS enabled and forced from the moment it exists |
| `rls/functions/65-execution-facts.sql` (new) | the execution facts, ONE source for the studio's cockpit and the client's page: which BOQs a delivery owns (only its own client's; a light delivery's by its project), THE contract it stands on (one rule for the studio and the client), a contract's money facts, its measured lines and works, and everything the execution card is derived from. The studio reads them as itself, under its own RLS |
| `rls/functions/75-client-home.sql` (new) | the client home (from PR H4): the page by its delivery link, its contract and change orders through the SAME functions as the contract and change-order links (so the document a client signs is the same), the one-time code request with its limits (60 s between codes for one document, 5 an hour for it, no new one for it after 15 wrong tries on its codes in an hour, 10 a day per delivery, 25 a day per studio, 80 a day across the platform; it also removes codes never used, 90 days after they expired, and keeps every used one), the four acts that will need a code (each answers `busy`, not an error, when a studio write holds what it needs), and where an old contract or change-order link sends its holder; plus their internal helpers and the codes table's guard |
| `rls/functions/40-delivery-read.sql` | the delivery link's answer gains `entry_phase` (`design`, or `execution` for a light delivery, from PR H4), so the client page knows a light delivery from the read it already makes; every other key is unchanged |
| `rls/functions/30-contracts-variations.sql`, `50-delivery-write.sql`, `70-execution-portal.sql` | the contract and change-order links, the two "I paid" functions and the execution card share four new helpers (how a contract was signed, the days approved change orders add, what is still due on a request, on a design instalment), with the same answers; the execution card stands on the delivery's contract by the cockpit's rule (a light delivery's found by its project; see step 2 (g)); the change-order guard is now its own function: everything it admitted before, plus issue restarting the link's 30 days; the change-order link reads a rejection recorded from the client's paper as the client's (none exists until PR H7) |
| `rls/policies/36-client-home.sql` (new), `policies/30-contracts-boqs-variations.sql` | the codes table's org isolation policy and guard trigger (a code changes only by one wrong try or its one use; it is deleted only with its delivery, or, never used, 90 days after it expired); the change-order trigger points at the new guard |
| `rls/roles.sql` | `metra_app` may read every column of the codes table but the code's hash, and write none of it (only the client home's own functions do); the new functions are callable by `metra_app` only, the helpers that take bare ids by nobody |

**1. Put the step C code in the production checkout.** This step adds no
dependency of `db:migrate` or `db:apply-rls`, so the installed `node_modules`
serve as they are. Right after the switch it saves a copy of this runbook:
the checkout undo (0) switches to does not contain this section.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/home-h3-sql
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-step-c.md
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 31e21c8f HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (31e21c8f)
git log --oneline HEAD..origin/main -- packages/db    # MUST print nothing: every database change on main is already in this code
git diff --name-only 65c78473 HEAD -- packages/db/migrations    # MUST print exactly the three 0065 files below
```

The last command must print exactly these three lines, in this order:

```
packages/db/migrations/0065_client_home.sql
packages/db/migrations/meta/0065_snapshot.json
packages/db/migrations/meta/_journal.json
```

The `Copy-Item` line saves this runbook (the branch's, which has this section)
to your Desktop; read the rest of it from that copy (undo (0) needs it). Four
STOPs, tell the lead in each case:

- The `git diff --stat 31e21c8f HEAD` lists any file other than
  `docs/DEPLOY.md`: the code is not the code that was rehearsed.
- The `git log ... -- packages/db` prints any line: database code reached
  `main` after this branch was last brought up to date, and this branch's
  `db:apply-rls` would take it away again.
- The migrations diff prints anything else: this runbook covers 0065 only.
- You ran step B from a pin other than `4cf2a68a`, or have not run it.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the LAST
result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 65 and `newest` 1792880198159 (0064's journal stamp).
Anything else: STOP, tell the lead.

```sql
-- Step C step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** every column 0. Anything else
means part of step C is already in this database: do not run step 3, tell the
lead.

```sql
-- Step C step 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'design_engagements' and column_name = 'entry_phase')
        or (table_name = 'variation_order_events' and column_name = 'recorded_on_paper'))) as step_c_columns,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('client_verification_codes', 'design_engagements_one_light_per_project_client')) as step_c_relations,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('app_delivery_boqs', 'app_delivery_current_contract', 'app_contract_measured_lines',
                        'app_contract_measured_works', 'app_contract_money_facts', 'app_execution_flow_source',
                        'app_payment_request_due', 'app_engagement_milestone_due', 'app_contract_signed',
                        'app_contract_time_extension_days', 'app_contract_terminated_at', 'enforce_variation_order_frozen',
                        'enforce_client_code_guarded', 'app_home_delivery', 'app_home_contract', 'app_home_flow_source',
                        'app_client_code_destination', 'app_email_hint', 'app_client_code_check',
                        'app_client_code_refusal', 'app_client_code_consume', 'app_home_by_token',
                        'app_home_contract_by_token', 'app_home_contract_sections_by_token',
                        'app_home_contract_section_lines_by_token', 'app_home_variations_by_token',
                        'app_home_code_issue_by_token', 'app_home_contract_ack_by_token',
                        'app_home_variation_respond_by_token', 'app_home_claim_request_by_token',
                        'app_home_claim_design_payment_by_token', 'app_client_home_target_by_token')) as step_c_functions,
  (select count(*) from pg_trigger where tgname = 'trg_client_verification_codes_guarded') as code_trigger,
  (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgname = 'trg_variation_orders_immutable' and p.proname = 'enforce_variation_order_frozen') as change_order_guard;
```

(c) The sizes. Note the five numbers; step 4 (e) expects the same.
`light_candidates` are the execution contracts no delivery stands behind: PR
H4 gives each a light delivery when the studio next opens its client page.
`change_orders_to_issue` are approved inside the studio and not yet sent: from
the merge on, issuing one gives the client a full 30 days from that day.

```sql
-- Step C step 2 (c): the sizes. Run this one alone.
select (select count(*) from public.design_engagements) as deliveries,
       (select count(*) from public.design_engagements where state = 'execution') as deliveries_at_execution,
       (select count(*) from public.contracts c join public.boqs b on b.org_id = c.org_id and b.id = c.source_boq_id
         where b.engagement_id is null and c.status in ('issued', 'signed')) as light_candidates,
       (select count(*) from public.variation_orders where status = 'internal_approved') as change_orders_to_issue,
       (select count(*) from public.contracts where token_hash is not null and status in ('issued', 'signed')) as contract_links;
```

(d) What every client link shows now, as one fingerprint per kind. Note the
four values; step 4 (f) expects the same four (a client who signs, answers or
says "I paid" in between changes one: then tell the lead which). The
delivery links are fingerprinted without `entry_phase`, the one key step C
adds to them (step 4 (h) checks it), so the four compare before and after.

```sql
-- Step C step 2 (d): what the client links show, fingerprinted. Run this one alone.
select
  (select md5(coalesce(string_agg(md5(coalesce(public.app_contract_by_token(c.token_hash)::text, '')), '' order by c.id), ''))
     from public.contracts c where c.token_hash is not null) as contract_links,
  (select md5(coalesce(string_agg(md5(coalesce(public.app_variation_by_token(v.token_hash)::text, '')), '' order by v.id), ''))
     from public.variation_orders v where v.token_hash is not null) as change_order_links,
  (select md5(coalesce(string_agg(md5(coalesce((public.app_delivery_by_token(d.token_hash) - 'entry_phase')::text, '')), '' order by d.id), ''))
     from public.design_engagements d where d.token_hash is not null) as delivery_links,
  (select md5(coalesce(string_agg(md5(coalesce(public.app_delivery_execution_by_token(d.token_hash)::text, '')), '' order by d.id), ''))
     from public.design_engagements d where d.token_hash is not null) as execution_cards;
```

(e) Expect `policies` 80 and `restrictive` 15 (step B's step 4 (f)). Step 4
(g) expects 81 and 15.

```sql
-- Step C step 2 (e): the policies, and how many are restrictive. Run this one alone.
select count(*) as policies,
       count(*) filter (where permissive = 'RESTRICTIVE') as restrictive
from pg_policies where schemaname = 'public';
```

(f) The database size. Write the number down; step 4 (i) reads it again.

```sql
-- Step C step 2 (f): the database size. Run this one alone.
select pg_size_pretty(pg_database_size(current_database())) as db_size;
```

(g) **The execution cards step C changes. Expect one row, `cards_changed` 0
and `boqs_other_client` 0.** `cards_changed` counts the deliveries at
execution whose execution card (and the "I paid" behind it) step C points
at another contract, or at none: a terminated contract that a newer issued
BOQ replaced, or a BOQ made for another client of the project.
`boqs_other_client` counts the BOQs a delivery at execution holds that were
made for another client of its project (the project's client changed while
the delivery ran), with a contract or not: from step C on, the delivery no
longer owns them, so its cockpit loses them (the merged code makes every new
one the delivery client's). Anything else: STOP before step 3 and tell the
lead both numbers.

```sql
-- Step C step 2 (g): the execution cards step C changes. Run this one alone.
select (
select count(*)
from public.design_engagements de
left join lateral (
  select c.id from public.boqs b
    join public.contracts c on c.org_id = b.org_id and c.source_boq_id = b.id
   where b.org_id = de.org_id and b.engagement_id = de.id and c.status in ('issued', 'signed', 'terminated')
   order by (c.status = 'terminated'), c.created_at desc, c.id desc
   limit 1
) shown_now on true
left join lateral (
  select c.id, c.status, c.source_boq_id from public.boqs b
    join public.contracts c on c.org_id = b.org_id and c.source_boq_id = b.id
   where b.org_id = de.org_id and b.engagement_id = de.id and b.client_id = de.client_id
   order by (c.status = 'terminated'), c.created_at desc, c.id desc
   limit 1
) newest on true
left join lateral (
  select b.id from public.boqs b
   where b.org_id = de.org_id and b.engagement_id = de.id and b.client_id = de.client_id and b.status = 'issued'
   order by b.created_at desc, b.id desc
   limit 1
) issued_boq on true
where de.state = 'execution'
  and shown_now.id is distinct from (
    case when newest.status = 'draft' or (newest.status = 'terminated' and issued_boq.id <> newest.source_boq_id)
         then null else newest.id end
  )
) as cards_changed,
(
select count(*)
from public.design_engagements de
join public.boqs b on b.org_id = de.org_id and b.engagement_id = de.id
where de.state = 'execution'
  and b.client_id <> de.client_id
) as boqs_other_client;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection), **at a
quiet hour** (late evening, when no studio is working; see *Locks*). Each
line runs its command only if the one before it exited 0, so a failure stops
the block there (a `db:apply-rls` on a database without 0065 would apply half
of its files and then fail):

```powershell
npm run db:migrate
if ($LASTEXITCODE -eq 0) { npm run db:apply-rls }
if ($LASTEXITCODE -eq 0) { npm run assert-schema-applied -w @metra/db }
```

**NOTICE blocks are normal.** Both commands print routine NOTICE blocks with
a `message:` line; on Supabase the line about a role may differ, and any line
that ends `does not exist, skipping` or `already exists, skipping` is the same
kind:

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`, in this order: the same first four as every run
  (`message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`,
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`,
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`,
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`),
  then TWO new ones, once only:
  `message: 'policy "org_isolation" for relation "public.client_verification_codes" does not exist, skipping',`
  and `message: 'trigger "trg_client_verification_codes_guarded" for relation "public.client_verification_codes" does not exist, skipping',`.
  A second `db:apply-rls` prints only the first four.

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure (after one, npm adds `npm error` lines of its own; they only repeat
that the command failed). Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (66).
- `db:apply-rls` exits 0 and ends with two lines. The first starts
  `apply-rls: verified in the catalogues` and goes on
  `66 tables, 81 policies, 36 triggers, 100 functions, RLS forced on all of them, role metra_app present.`;
  the second starts `apply-rls: grants verified` and goes on
  `design_engagements update narrowed to 19 columns with no table-level update, and 24 narrowed table(s) (boqs, client_verification_codes, contract_cost_entries, contract_line_measurements, contract_payment_claims, contract_payments, document_categories, engagement_document_comments, engagement_milestones, market_bulletins, market_categories, market_item_details, market_items, market_price_observations, market_seed_book, payment_requests, project_assignments, site_devices, site_location_consents, site_material_receipts, site_notes, site_photos, site_visits, workspace_entitlements) holding exactly what rls/roles.sql leaves them; contract_line_measurements insertable on every column but seq; contract_cost_entries updatable on its 15 entry and void columns only; contract_payment_claims updatable on its 5 answer columns only; client_verification_codes readable on every column but code_hash; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`
  If that second line is replaced by a problem list, it exits 1: something
  was added by hand (or step B is missing). Do not merge; tell the lead.
- `assert-schema-applied` exits 0 and prints six lines, each starting
  `assert-schema-applied:`, in this order: `OK` then `66 declared table(s), every column present.`;
  `indexes` then `150 declared, all present.`; `constraints` then
  `413 declared, all present.`; `functions` then `100 declared, all present.`;
  `orphaned org rows` then
  `58 org-scoped table(s) answered, none holds a row whose org_id names no organization.`;
  and `composite set-null FKs` then
  `16 found (16 declared in src/schema/), every one narrowed to a single non-org_id column.`

**A lock race in `db:apply-rls` is retried for you.** A line like
`apply-rls: policies/30-contracts-boqs-variations.sql rolled back with SQLSTATE 55P03 on attempt 1 of 3 (a lock race with live traffic); trying it again in 2 s.`
followed by `Applying policies/30-contracts-boqs-variations.sql ... (attempt 2 of 3)`
is NOT a failure: that one file rolled back whole and is being applied again
(3 attempts, 2 s then 4 s apart). Carry on reading the output.

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: 0065: could not take every lock within 3 s (stopped at public.design_engagements:ACCESS EXCLUSIVE)`
  (the table named may be `organizations` or `variation_order_events`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  The migration takes its three locks ALL OR NONE (see *Locks*): it tries for
  all three at once, lets go of the ones it got when another table is busy,
  and tries again, for 3 s in all. This line means the named table never came
  free in those 3 s: a long query or transaction held it, or requests kept it
  busy without a gap. It held nothing while it tried, so no request waited on
  it, and the block ran nothing after it. Re-run the block a little later.
  Rehearsed: a reader holding
  `design_engagements` for 10 s gave exactly these two lines after 5.4 s,
  `migrations` stayed 65, step 2 (b) still read all 0, and the re-run after
  the reader finished applied 0065.
- `apply-rls failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `apply-rls failed: lock wait or deadlock, safe to re-run at a quieter moment (this file rolled back; the files before it stay applied).`
  That means the same file lost three times in a row. The cause is NOT a
  broken database (the block skipped `assert-schema-applied`): a 55P03 is a
  studio transaction or report that held a table for more than 3 s (step C's
  own files touch `variation_orders` in
  `policies/30-contracts-boqs-variations.sql` and the new codes table, as well
  as the tables every run touches); a 40P01, almost always at
  `Applying policies/00-core.sql ...`, is ordinary studio traffic (step B's
  runbook says why). **Run `npm run db:apply-rls` again, and keep re-running it
  until it exits 0** (wait a minute between runs; it is safe, every statement is
  idempotent), then `npm run assert-schema-applied -w @metra/db`. The run
  that exits 0 prints the two new notices of step 3 if the failed run did not
  get past `policies/36-client-home.sql`. Until a run exits 0, the new
  functions may exist while the change-order trigger is still the old one and
  the codes table has no policy
  yet: the current site works on that (it calls none of the new functions,
  and the old trigger is what it was written for), `metra_app` reads nothing
  in the forced codes table, and nothing writes it. In between, step 2 (b) may
  show `step_c_functions` 32 with `code_trigger` 0 and `change_order_guard` 0.
  Rehearsed: see *Rehearsed* below.
- `Migration failed: SQLSTATE 42701: column "entry_phase" of relation "design_engagements" already exists`
  (or `42P07` or `42710`, "already exists", for a table, an index or a
  constraint) then
  `Migration failed: tell the lead before running anything else (the whole batch rolled back, nothing was changed).`:
  part of step C is already in this database, which step 2 (b) would have
  shown. Nothing changed; tell the lead.
- Any other code ends `tell the lead before running anything else`.

**Safe to re-run.** `db:migrate` records 0065 only when the whole batch
commits, so after any failure a re-run starts again from 0064; after a
success it finds nothing pending and prints `Migrations applied.` again
(rehearsed). Every statement under `rls/` is idempotent: a second
`db:apply-rls` prints the same two verified lines and only the first four
notices (rehearsed). `assert-schema-applied` only reads.

**Locks.** `db:migrate` runs 0065 as ONE transaction. It first takes every lock
it needs, ALL OR NONE, within ONE 3 s budget for all its attempts together:
ACCESS EXCLUSIVE (no reads, no writes) on `design_engagements`, SHARE ROW
EXCLUSIVE (reads go on, writes wait) on `organizations` (the new table's
foreign key) and ACCESS EXCLUSIVE on `variation_order_events` (its new
column). Each attempt asks for all three without waiting; if one is busy it
lets go of the others, sleeps 10 to 40 ms and tries again, so it never holds
one of them while it waits for another (a studio save reads the membership,
then the studio row). Then, holding them, it adds the two columns (no
rewrite: a constant default), checks the two new checks over every delivery
(one scan each), builds the light-delivery index, and creates the empty
table. A change-order page waits for this window too. `design_engagements`
is read by every delivery page, a client's link included, so those pages
wait for this window, briefly: the whole
migration took 22 to 128 ms (median 24) on a quiet local server and 22 to 110
ms (median 52) beside about 220 studio and client requests a second, 30 of 30
runs clean, 0 deadlocks, 0 failed requests, the slowest request 183 ms.
With the change-order column and its third lock (H3 round 2), the file ran
in 13 to 67 ms (median 14) on a quiet local server at this rehearsal's size
(21 deliveries, 10 runs); the figures beside traffic were not measured again.
Supabase is slower than a local server (a window measured there earlier was
0.5 to 1.9 s), so a delivery page can wait about 1 s; none fails because of it.
Estimates from a local server, not a production measurement; step 2 (c) gives
the size to compare with (the H3 build's rehearsal, where these figures come from, had 61 deliveries; production has fewer).
`db:apply-rls` adds one policy file on the new table (nothing waits on it),
re-creates the change-order trigger in `policies/30-contracts-boqs-variations.sql`
exactly as every run already does, and runs every other file as it always does
(the worst cases in step B's runbook are unchanged); a file that loses a lock
race is tried again (above).

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) Step 2 (a) again: `migrations` 66, `newest` 1792976742588 (0065's journal
stamp).

(b) Step 2 (b) again: now `step_c_columns` 2, `step_c_relations` 2,
`step_c_functions` 32, `code_trigger` 1 and `change_order_guard` 1.

(c) The codes table: one row, with `rls` true, `forced` true, `policies` 1,
`app_reads` true, `app_reads_code_hash` false, `app_writes` false,
`api_roles_read` false, `triggers` 1 and `codes` 0.

```sql
-- Step C step 4 (c): the codes table's RLS, grants and trigger. Run this one alone.
select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       has_any_column_privilege('metra_app', c.oid, 'select') as app_reads,
       has_column_privilege('metra_app', c.oid, 'code_hash', 'select') as app_reads_code_hash,
       (has_table_privilege('metra_app', c.oid, 'insert') or has_table_privilege('metra_app', c.oid, 'update')
         or has_table_privilege('metra_app', c.oid, 'delete')) as app_writes,
       coalesce((select bool_or(has_any_column_privilege(r.oid, c.oid, 'select')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated')), false) as api_roles_read,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers,
       (select count(*) from public.client_verification_codes) as codes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'client_verification_codes';
```

(d) Who may call the step C functions: 32 rows. `public_execute` false and
`api_roles_execute` false on all 32. `definer` true on eleven: the ten
`app_home_..._by_token` functions (`app_home_by_token` among them) and
`app_client_home_target_by_token`; false on the other twenty-one.
`app_execute` true on those eleven, on the six fact functions
(`app_delivery_boqs`, `app_delivery_current_contract`,
`app_contract_measured_lines`, `app_contract_measured_works`,
`app_contract_money_facts`, `app_execution_flow_source`) and on the two
trigger functions (`enforce_client_code_guarded`,
`enforce_variation_order_frozen`); false on the other thirteen (internal:
nobody calls them but the functions beside them).

```sql
-- Step C step 4 (d): who may call the step C functions. Run this one alone.
select p.proname, p.prosecdef as definer,
       has_function_privilege('metra_app', p.oid, 'execute') as app_execute,
       exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as public_execute,
       coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                  where r.rolname in ('anon', 'authenticated', 'service_role')), false) as api_roles_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('app_delivery_boqs', 'app_delivery_current_contract', 'app_contract_measured_lines',
                    'app_contract_measured_works', 'app_contract_money_facts', 'app_execution_flow_source',
                    'app_payment_request_due', 'app_engagement_milestone_due', 'app_contract_signed',
                    'app_contract_time_extension_days', 'app_contract_terminated_at', 'enforce_variation_order_frozen',
                    'enforce_client_code_guarded', 'app_home_delivery', 'app_home_contract', 'app_home_flow_source',
                    'app_client_code_destination', 'app_email_hint', 'app_client_code_check',
                    'app_client_code_refusal', 'app_client_code_consume', 'app_home_by_token',
                    'app_home_contract_by_token', 'app_home_contract_sections_by_token',
                    'app_home_contract_section_lines_by_token', 'app_home_variations_by_token',
                    'app_home_code_issue_by_token', 'app_home_contract_ack_by_token',
                    'app_home_variation_respond_by_token', 'app_home_claim_request_by_token',
                    'app_home_claim_design_payment_by_token', 'app_client_home_target_by_token')
order by 1;
```

(e) Step 2 (c) again: the same five numbers as before.

(f) Step 2 (d) again: the same four fingerprints as before (every client link
shows exactly what it showed, a delivery link but for its new `entry_phase`;
step 2 (g) was 0 and 0).

(g) Step 2 (e) again: now `policies` 81 and `restrictive` 15.

(h) Every delivery begins in design, the new checks and index are valid, and
every live delivery link says its `entry_phase`, and no change-order event
is marked as recorded on paper: one row, `not_design` 0, `valid_checks` 2,
`valid_light_index` 1, `links_phase_wrong` 0, `paper_decisions` 0.

```sql
-- Step C step 4 (h): the new column, checks and index. Run this one alone.
select (select count(*) from public.design_engagements where entry_phase <> 'design') as not_design,
       (select count(*) from pg_constraint
         where conname in ('design_engagements_entry_phase_known', 'design_engagements_light_is_execution')
           and convalidated) as valid_checks,
       (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
         where c.relname = 'design_engagements_one_light_per_project_client' and i.indisvalid) as valid_light_index,
       (select count(*) from public.design_engagements d
         cross join lateral (select public.app_delivery_by_token(d.token_hash) as link) l
         where l.link is not null and l.link ->> 'entry_phase' is distinct from d.entry_phase) as links_phase_wrong,
       (select count(*) from public.variation_order_events where recorded_on_paper) as paper_decisions;
```

(i) Step 2 (f) again: about the same size as before (the new table is empty;
the rehearsal went from 34 MB to 35 MB). Put the number in the release note.

**Stop and do not go on** if any output in steps 3 or 4 differs from what is
written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still runs
the current `main`. About ten minutes, in your own studio only. Open the log
first, in a second window, and leave it open:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

Then, signed in to your own studio:

1. **Page loads.** Open **Contracts** in the sidebar (العقود) and one contract,
   then, if it is an execution contract, its **Payments** tab (الدفعات) and its
   change-order tab. Then **Deliveries** (التسليمات) and a delivery at the
   execution stage (its cockpit shows the execution card), a project and the
   dashboard. Expected: every page loads and shows your data as before. A list
   that is suddenly EMPTY counts as a failure too.
2. **The client links, only if you have a test one.** If a test project of
   yours has a contract link (`/c/...`), a change-order link (`/v/...`) or a
   delivery link (`/d/...`) you sent to yourself, open each: it shows as
   before. Only look: do not sign, approve or say you paid anything. No test
   link: skip this; do not create one for it.

Expected in the log for all of the above: no `42501`, no `42883`, no `MT100`,
no `mutateInOrg failed`.

**If anything in step 5 fails:** do not merge. Run undo (0) below now, then
tell the lead what you saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (the same evening: nothing breaks while it
   waits, but the two codes should not run side by side for days).
2. Smoke test on your own studio, the log still open: the page loads of step 5
   (1) again, now on the new code; on an execution contract, also its final
   account page (الحساب الختامي) if it has one. Expected: every page loads as
   before, and the log shows no `42883`, no `42501`, no `MT100` and no
   `mutateInOrg failed`.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(0) The database code, before the merge** (step 5 fails, or before the merge
the log shows a `42501`, a `42883` or an `MT100`, or a studio reports a broken
page). Three parts: one SQL block that takes away the one policy the previous
code does not declare (that code's own check refuses a policy it does not
declare); the `db:apply-rls` of `main` (`65c78473`, the database code
production ran on just before step 3: step B's), which puts back the five
rewritten functions, the delivery link without `entry_phase`, the execution
card without the light scope and the old change-order trigger; then one SQL
block that removes what that code does not know (the codes table's trigger
and the 32 functions). It leaves 0065 itself
alone: the two new columns, the checks, the index and the empty codes table stay
(forced, with no policy, so `metra_app` reads nothing in it; the current site
never touches it). Afterwards the database is exactly as it was before step 3,
but for those 0065 objects: rehearsed, a catalogue comparison found zero other
differences. Use it only while the site still runs the code from before the
merge: if the new code is already deployed, undo (1) the code first, then
this.

First, in the Supabase SQL editor, on its own. Expected: one row,
`client_home_policies` 0.

```sql
-- Step C undo (0), part 1: the one policy main's code does not declare. Run this one alone.
set lock_timeout = '3s';
drop policy if exists org_isolation on public.client_verification_codes;
select count(*) as client_home_policies from pg_policies
where schemaname = 'public' and tablename = 'client_verification_codes';
```

If it fails with `canceling statement due to lock timeout`, nothing was
dropped: run it again a minute later. Then, from the copy you saved in step 1:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach 65c78473
git log --oneline -1    # 65c78473 merge: main (site release 83279b89) into the B4 release
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout, at a quiet hour as in step 3.
Expected: it exits 0; only the FIRST FOUR notices of step 3; and it ends with
the two lines that code prints, the first going on
`65 tables, 80 policies, 35 triggers, 68 functions, RLS forced on all of them, role metra_app present.`
and the second the same as step 3's WITHOUT `client_verification_codes, ` in
the table list (`23 narrowed table(s)`) and WITHOUT
`client_verification_codes readable on every column but code_hash; `. A
problem list naming `policy client_verification_codes.org_isolation` means part
1 was not run first: run it, then this again.

**If this `db:apply-rls` fails** with the two `apply-rls failed:` lines of step
3 (`SQLSTATE 40P01` or `55P03`), it is the same lock race with live traffic as
in step 3 (that code retries a file for you too, the same 3 attempts): **run
`npm run db:apply-rls` again from this checkout, and keep re-running it until it
exits 0.** Any other code: stop and tell the lead.

**Do not run the SQL block below until this `db:apply-rls` has exited 0.** Run
before it (part 1 run or not), the block fails with `cannot drop function
enforce_variation_order_frozen() because other objects depend on it`
(SQLSTATE `2BP01`: the change-order trigger still uses the new guard) and
drops nothing, as the editor runs it as one transaction. The fix is the order
above: part 1, then this `db:apply-rls` until it exits 0, then the block.

Then, in the Supabase SQL editor, this block, on its own:

```sql
-- Step C undo (0), part 2: the objects main's code does not know. Run this one alone.
set lock_timeout = '3s';
drop trigger if exists trg_client_verification_codes_guarded on public.client_verification_codes;
drop function if exists public.app_home_by_token(text);
drop function if exists public.app_home_contract_by_token(text);
drop function if exists public.app_home_contract_sections_by_token(text, integer);
drop function if exists public.app_home_contract_section_lines_by_token(text, uuid, integer);
drop function if exists public.app_home_variations_by_token(text);
drop function if exists public.app_home_code_issue_by_token(text, uuid, text, text, text, text, text);
drop function if exists public.app_home_contract_ack_by_token(text, uuid, uuid, text, text, text, text, text);
drop function if exists public.app_home_variation_respond_by_token(text, uuid, text, uuid, text, text, text, text);
drop function if exists public.app_home_claim_request_by_token(text, uuid, uuid, text, text, text, text, text);
drop function if exists public.app_home_claim_design_payment_by_token(text, text, uuid, text, text, text, text, text);
drop function if exists public.app_client_home_target_by_token(text, text);
drop function if exists public.app_home_flow_source(uuid);
drop function if exists public.app_home_contract(text);
drop function if exists public.app_home_delivery(text);
drop function if exists public.app_client_code_destination(uuid, uuid);
drop function if exists public.app_email_hint(text);
drop function if exists public.app_client_code_check(uuid, uuid, uuid, text, text, text);
drop function if exists public.app_client_code_refusal(text);
drop function if exists public.app_client_code_consume(uuid, uuid);
drop function if exists public.enforce_client_code_guarded();
drop function if exists public.enforce_variation_order_frozen();
drop function if exists public.app_execution_flow_source(uuid);
drop function if exists public.app_contract_money_facts(uuid);
drop function if exists public.app_contract_measured_works(uuid);
drop function if exists public.app_contract_measured_lines(uuid);
drop function if exists public.app_delivery_current_contract(uuid, uuid);
drop function if exists public.app_delivery_boqs(uuid, uuid);
drop function if exists public.app_payment_request_due(uuid, uuid);
drop function if exists public.app_engagement_milestone_due(uuid, text);
drop function if exists public.app_contract_signed(uuid, uuid);
drop function if exists public.app_contract_terminated_at(uuid, uuid);
drop function if exists public.app_contract_time_extension_days(uuid, uuid);
```

Expected: `Success. No rows returned`. Run it at the same quiet hour: the
`drop trigger` locks the codes table, and the first line makes the block give
up after 3 s. If it fails with `canceling statement due to lock timeout`,
nothing was dropped (the editor runs the block as one transaction): run the
same block again a minute later, until it succeeds. Then, read-only, each
block ON ITS OWN: step 2 (b) again (now `step_c_columns` 2,
`step_c_relations` 2, and 0, 0, 0: the 0065 objects stay, the rest is gone),
step 2 (d) again (the same four fingerprints) and step 2 (e) again (80 and 15).
Then step 5 again: everything works as it did before step 3. Put the checkout
back on main (step 6 (3)) and tell the lead what failed the first time. Do not
merge. If step 5 STILL fails after undo (0), the database code was not the
cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then from
step 3 only `npm run db:apply-rls` (0065 is still applied, so `db:migrate` is
not needed; if you run it anyway it prints `Migrations applied.` and changes
nothing). Expected: the first four notices of step 3, then the same two new
ones and the same two verified lines (re-run until it exits 0, as step 3
says); then step 4 and on.

**(1) The code** (a page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**(2) The schema** (the two columns, the index and the codes table): only if
the client home is abandoned, and only while no light delivery, no code and
no paper decision exists (step 2 (b)'s companions: `select count(*) from
public.design_engagements where entry_phase = 'execution'`, `select count(*)
from public.client_verification_codes` and `select count(*) from
public.variation_order_events where recorded_on_paper`, all 0). Tell the
lead first: it is a revert of `rls/` and a new migration, never a hand edit
here.

**Rehearsed** (client home H3, its fix round and round 2, Oct 26). After round
2, every command and SQL block above was run again as written, at
`31e21c8f`, on a local PostgreSQL 17 database (UTF8) built in production's own
order:
Supabase's API roles and default grants simulated first; then `main`'s
database code at `0f9cb2db` (`db:migrate`, `db:apply-rls`, `seed`); DB step S
from `992bca1e`; DB step B's `db:apply-rls` from `65c78473` (`65 tables, 80
policies, 35 triggers, 68 functions`) and `assert-schema-applied`; then data
written by `main`'s own cores (three studios: deliveries at every execution
stage, a client's claim, change orders approved, internal and expired, a
final account, a termination, contracts no delivery stands behind) and a bulk
of ten studios: 2,023 contracts (1,015 issued or signed with a client link),
20,170 contract lines, 21 deliveries, 18 of them at execution. The runs used a
fresh clone standing in for `merta-main` (its own `npm ci`, `origin` on
GitHub, `origin/main` at `65c78473`): the PowerShell cut from this section
with three substitutions only (the checkout path, the Desktop path, and the
connection set in the session in place of `.env`), the SQL from the saved
copy, each block on its own.

- Steps 1 to 4 printed exactly what they say. Step 1's guards printed only the
  `docs/DEPLOY.md` line and the three 0065 files, and the saved copy equals the
  branch's runbook. Step 2 read 65 and 1792880198159; all 0; 21, 18, 6, 3 and
  1,015; four fingerprints (the delivery links' the same as without the
  `- 'entry_phase'`, which changes nothing before step C); 80 and 15; 34 MB;
  `cards_changed` 0 and `boqs_other_client` 0. Step 3 printed the two migrate
  notices, the four and the two apply-rls notices, the two verified lines
  (compared character for character) and the six `assert-schema-applied`
  lines, and exited 0. Step 4 read 66 and 1792976742588; 2, 2, 32, 1 and 1; the
  codes table row as written; 32 rows in (d) (eleven definers, nineteen
  callable by `metra_app`, thirteen internal); the same five numbers and four
  fingerprints; 81 and 15; 0, 2, 1, 0 and 0; 35 MB. All 21 delivery links now
  carry `entry_phase`. A second step 3 printed only what *Safe to re-run* says
  and changed nothing in the catalogue.
- A catalogue comparison (every function body with its settings and grants,
  policy, trigger, table and column grant, constraint, index and RLS flag) from
  step B to step C found exactly the changes under *What it changes*: 32
  functions added; seven replaced (the contract, change-order and delivery
  links, the two "I paid" functions, the execution card and its contract
  helper); 1 policy; the codes table's trigger and the re-pointed change-order
  trigger; the codes table with its grants, constraints and indexes; the
  change-order event column (`metra_app` may insert it, by its table grant);
  nothing else.
- **The migration's lock race, on purpose.** A reader holding
  `design_engagements` for 10 s against step 3: the two 55P03 lines, exit 1,
  nothing run after them, `migrations` still 65, step 2 (b) all 0. A reader
  holding `variation_order_events` for 10 s: the same two lines, stopped at
  `public.variation_order_events:ACCESS EXCLUSIVE`, the same state. The block
  run again after the readers ended applied 0065.
- **apply-rls's lock race, on purpose.** A reader holding `variation_orders`
  for 30 s while step 3 ran (0065 then applied): `policies/30-contracts-boqs-variations.sql`
  lost three times (55P03, retried after 2 s and 4 s), the two failure lines,
  exit 1, and `assert-schema-applied` skipped; in between, step 2 (b) read 2,
  2, 32, 0 and 0. `db:apply-rls` run again after the reader ended exited 0 with
  the four and the two notices, `assert-schema-applied` exited 0, and the
  catalogue was identical to a clean run's.
- **Undo (0)**, from the saved copy. Part 2 run first, and again after part 1
  but before `main`'s `db:apply-rls`: both times `cannot drop function
  enforce_variation_order_frozen() because other objects depend on it`
  (2BP01), and step 2 (b) still read 2, 2, 32, 1 and 1: nothing dropped. Part
  1 while a reader held the codes table for 6 s: `canceling statement due to
  lock timeout`, nothing dropped; run again, 0. `main`'s `db:apply-rls` run
  before part 1 (on a second step C database): not landed, naming `policy
  client_verification_codes.org_isolation`. Then, in order: `65c78473`'s
  `db:apply-rls` printed the four notices and the two lines quoted there (the
  grants line exactly as derived) and exited 0; part 2 returned no rows; step
  2 (b) read 2, 2, 0, 0 and 0, step 2 (d) the same four fingerprints and step
  2 (e) 80 and 15; and the catalogue equalled step B's but for the 0065
  objects it keeps (the two columns among them; every function, the delivery
  and change-order links' included, as at step B).
- **Forward again** (step 1, then this branch's `db:apply-rls` only): the four
  and the two notices, the two verified lines, exit 0; step 2 (b) 2, 2, 32, 1
  and 1, the same four fingerprints, 81 and 15, step 4 (h) 0, 2, 1, 0 and 0;
  and a catalogue identical to the first forward's. Step 6 (3) then put the
  checkout back on `main`.
- **Step 2 (g) itself**, on a copy of the database at step B with three
  deliveries planted (one whose signed contract was terminated and replaced by
  a newer issued BOQ; one with a newer issued BOQ, a contract on it, made for
  another client of the project; one with an issued BOQ made for another
  client and no contract): `cards_changed` 2 (the first two) and
  `boqs_other_client` 2 (the last two; the third is the case only this column
  sees). After step C the execution card changed for exactly the first two of
  the 18 deliveries at execution, and neither of the last two owned the other
  client's BOQ any more. On the clean database both read 0.
- **The current code on the step C database:** `main`'s (`65c78473`) own
  isolation gate passed 60 of 60, and its action tests 1,699 of 1,701, on a
  copy of this step C database (both new columns in it). The two failures
  test schema objects, not an app path: one pins the list of token functions
  in the database, which step C extends; the other fails the same way on the
  step B database (it checks a Supabase default grant that the simulated
  roles add and `roles.sql` does not manage). No contract, change order
  (the termination cascade included), delivery, payment, claim, final
  account or measurement test of the shipped code failed.
- **Carried over from the H3 build's rehearsal:** the migration's lock window
  beside studio traffic under *Locks* (round 2 added the change-order column
  and a third lock; that file was measured on a quiet server only, as *Locks*
  says) and the 36 `db:apply-rls` runs beside studio traffic (the fix rounds
  changed function bodies and grants, which every run re-creates, and no
  policy file but comments).
- **This branch's own tests** on a fresh database replayed as CI does: the
  isolation gate and every action test passed (one timing test,
  `execution-transaction-bounds`, failed once while the same machine ran the
  unit suite beside it, and passed three of three on its own).

### Client codes DB step D (0066, the one-time codes): owner runbook

The client codes' database step: migration `0066_client_codes_step_d.sql`
plus `db:apply-rls` (changes to `rls/functions/75-client-home.sql` and
`rls/roles.sql`; no new file). It runs AFTER client home DB step C (the
section above): production then holds 66 migrations, 81 policies (15 of them
restrictive) and 100 functions; step D leaves it at 67, 81 (15) and 102 (two
functions are added, and eight are replaced by new forms). It is validated on
branch `validate/home-h5`, whose code is pinned at **`52ac1ae4`**: the
branch's last code commit (every commit after it changes only
`docs/DEPLOY.md`). That branch is `main` (`bab6de80`: PR H3, PR H4 and the
paper decision) plus PR H5 and its fix round: the client's one-time codes,
and "I paid" only through a code.

**Step D is not the last client home step.** DB step C2 (apply-rls only)
still comes later, after PR H7 is live: the four old client acts will then
answer `moved` unless a code was checked first. Step D changes none of those
four answers.

**THE ORDER (do not change it):**

0. **Already done:** client home **DB step C**, run from its pin `31e21c8f`,
   and PR H3 merged: `main` is `bab6de80` or later. Step 1 checks the code;
   check yourself that you ran step C.
1. **The database goes first**, from the branch (steps 1 to 4 below), while
   production still runs the current `main`.
2. **Then a short check of the live site on the new database (step 5),**
   still before any merge. If it fails, undo (0) puts the previous database
   code back.
3. **Then, right after that check,** the lead merges the branch to `main`, the
   Deploy workflow deploys it, and you run the smoke test (step 6).

Why this order, one sentence each:

- **The new code needs the new database code:** a client's code request and
  "I paid" call the new forms of the code functions (the code is checked by
  the payment it is for, not by an id the browser keeps), which the old
  database does not have, so every code request would fail with a reference.
- **The current Worker is safe on the new database, with no visible
  difference:** 0066 only adds an empty column to `design_engagements` that
  the current code never reads or writes, and an index to the codes table,
  which is empty (no released code asks for a code yet); the functions step D
  replaces or adds have no caller in the current code (checked on `main` at
  `bab6de80`: no file under `apps/web/src` names them).
- **No client sees anything new** until PR H5 is merged.
- **PR H6-read** (not merged yet) calls the two contract page reads in their
  OLD form: from step D on it must pass the contract id (the lead's ruling),
  so it is merged only after step D, with that change.

**What it changes.** No existing row is updated and nothing is backfilled.

| Object | Change |
|---|---|
| `design_engagements` | one column, `client_codes_reset_at` (empty on every row, no default): when an owner or admin last reset the client's one-time codes on that delivery. Written only by `app_client_codes_reset` below; `metra_app` may not update it (it holds the table's SELECT and INSERT, as on every other column of this table) |
| `client_verification_codes` | one partial index, `client_verification_codes_unused_created_idx` (the codes never used, or never sent, by when they were made): the code request removes such codes 90 days after they expired, and reads them through it without walking past the used ones, which stay as evidence |
| `app_home_code_issue_by_token` | a new form without the code id the app used to make (the old one is dropped). The limits: 60 s and 5 an hour for one payment, 15 wrong tries on its codes in an hour, **10 codes a delivery a day** (counted from the studio's last reset), 25 a studio a day and 80 across the platform; a code whose email failed counts only toward its payment's 60 s. A refusal names the limit that fired; a lock wait on any table answers `busy`. Its `ok` answer carries, for the server only, the code's row, the studio's two names, the document's number and whether this code is the one that took the platform's day to half its 80 |
| `app_client_code_check` (internal) | a new form: it checks the code against the NEWEST code of the payment it is for (a client back from the email, or after a reload, can still type it) |
| `app_home_contract_ack_by_token`, `app_home_variation_respond_by_token`, `app_home_claim_request_by_token`, `app_home_claim_design_payment_by_token` | new forms without the code id; a lock wait on any table answers `busy`; "I paid" past the contract's 10 claims in an hour answers `too_many` with the wait |
| `app_home_code_unsent_by_token` (new) | the server marks a code whose email failed as never sent, so it spends no day |
| `app_client_codes_reset` (new) | an owner's or admin's reset of one client's codes on one delivery (the client link dialog, audited): every code sent before it stops working, and the delivery's own limits count from it |
| `app_home_contract_sections_by_token`, `app_home_contract_section_lines_by_token` | each now takes the id of the contract the client opened, and answers nothing unless that contract is still the home's: an open document never gains a replaced contract's sections (H6-read security S1). The old forms (without the id) are dropped |
| `enforce_client_code_guarded` (trigger) | the 90-day purge may also remove a code that was never sent |
| `rls/roles.sql` | the grants follow the new forms: callable by `metra_app` only (the code check: by nobody) |

**1. Put the step D code in the production checkout.** This step adds no
dependency of `db:migrate` or `db:apply-rls`, so the installed `node_modules`
serve as they are. Right after the switch it saves a copy of this runbook:
the checkout undo (0) switches to does not contain this section.

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/validate/home-h5
Copy-Item docs\DEPLOY.md $HOME\Desktop\runbook-step-d.md
git log --oneline -1    # a "docs(deploy): ..." commit (this runbook); CI green on it
git diff --stat 52ac1ae4 HEAD    # MUST list only docs/DEPLOY.md: the code is exactly what was rehearsed (52ac1ae4)
git log --oneline HEAD..origin/main -- packages/db    # MUST print nothing: every database change on main is already in this code
git diff --name-only bab6de80 HEAD -- packages/db/migrations    # MUST print exactly the three 0066 files below
```

The last command must print exactly these three lines, in this order:

```
packages/db/migrations/0066_client_codes_step_d.sql
packages/db/migrations/meta/0066_snapshot.json
packages/db/migrations/meta/_journal.json
```

The `Copy-Item` line saves this runbook (the branch's, which has this section)
to your Desktop; read the rest of it from that copy (undo (0) needs it). Four
STOPs, tell the lead in each case:

- The `git diff --stat 52ac1ae4 HEAD` lists any file other than
  `docs/DEPLOY.md`: the code is not the code that was rehearsed.
- The `git log ... -- packages/db` prints any line: database code reached
  `main` after this branch was last brought up to date, and this branch's
  `db:apply-rls` would take it away again.
- The migrations diff prints anything else: this runbook covers 0066 only.
- You ran step C from a pin other than `31e21c8f`, or have not run it.

**2. Read-only, before** (Supabase SQL editor). The editor shows only the LAST
result of what you run, so run each block below ON ITS OWN.

(a) Expect `migrations` 66 and `newest` 1792976742588 (0065's journal stamp).
Anything else: STOP, tell the lead.

```sql
-- Step D step 2 (a): migrations recorded so far. Run this one alone.
select count(*) as migrations, max(created_at) as newest
from drizzle.__drizzle_migrations;
```

(b) **THE PRE-CHECK. Exactly this row, or STOP:** `step_d_index` 0,
`reset_column` 0, `step_d_functions` 0, `step_c_functions` 3. Anything else
means part of step D is already in this database (or step C is not): do not
run step 3, tell the lead.

```sql
-- Step D step 2 (b): the pre-check. Run this one alone.
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'client_verification_codes_unused_created_idx') as step_d_index,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'design_engagements' and column_name = 'client_codes_reset_at') as reset_column,
  (select count(*) from (values
     (to_regprocedure('public.app_home_code_issue_by_token(text, text, text, text, text, text)')),
     (to_regprocedure('public.app_home_code_unsent_by_token(text, uuid)')),
     (to_regprocedure('public.app_client_codes_reset(uuid)')),
     (to_regprocedure('public.app_home_contract_sections_by_token(text, uuid, integer)')),
     (to_regprocedure('public.app_home_contract_section_lines_by_token(text, uuid, uuid, integer)'))) f(p)
    where f.p is not null) as step_d_functions,
  (select count(*) from (values
     (to_regprocedure('public.app_home_code_issue_by_token(text, uuid, text, text, text, text, text)')),
     (to_regprocedure('public.app_home_contract_sections_by_token(text, integer)')),
     (to_regprocedure('public.app_home_contract_section_lines_by_token(text, uuid, integer)'))) f(p)
    where f.p is not null) as step_c_functions;
```

(c) The codes table. Note the two numbers (production has had no caller of
the code request, so expect 0 and 0); step 4 (e) expects the same.

```sql
-- Step D step 2 (c): the codes table. Run this one alone.
select count(*) as codes, count(*) filter (where consumed_at is null) as never_used
from public.client_verification_codes;
```

(d) Expect `policies` 81 and `restrictive` 15 (step C's step 4 (g)). Step 4
(f) expects the same.

```sql
-- Step D step 2 (d): the policies, and how many are restrictive. Run this one alone.
select count(*) as policies,
       count(*) filter (where permissive = 'RESTRICTIVE') as restrictive
from pg_policies where schemaname = 'public';
```

(e) The database size. Write the number down; step 4 (g) reads it again.

```sql
-- Step D step 2 (e): the database size. Run this one alone.
select pg_size_pretty(pg_database_size(current_database())) as db_size;
```

**3. Migrate, then apply RLS, then prove it landed.** In this order, from
`C:\Users\HP\merta-main` (its `.env` is the production connection), **at a
quiet hour** (late evening, when no studio is working; see *Locks*). Each
line runs its command only if the one before it exited 0, so a failure stops
the block there:

```powershell
npm run db:migrate
if ($LASTEXITCODE -eq 0) { npm run db:apply-rls }
if ($LASTEXITCODE -eq 0) { npm run assert-schema-applied -w @metra/db }
```

**NOTICE blocks are normal.** Both commands print routine NOTICE blocks with
a `message:` line; on Supabase the line about a role may differ, and any line
that ends `does not exist, skipping` or `already exists, skipping` is the same
kind:

- `db:migrate`: `message: 'schema "drizzle" already exists, skipping',` and
  `message: 'relation "__drizzle_migrations" already exists, skipping',`
- `db:apply-rls`: the same first four as every run
  (`message: 'function public.app_delivery_respond_by_token(text,text,text,text,text,text) does not exist, skipping',`,
  then `message: 'function public.app_delivery_choose_concept_by_token(text,uuid,text,text,text,text) does not exist, skipping',`,
  then `message: 'role "postgres" has already been granted membership in role "metra_app" by role "postgres"',`,
  then `message: 'policy "self_memberships" for relation "public.memberships" does not exist, skipping',`),
  and nothing else on this first run (the old forms step D replaces exist,
  so their DROPs print nothing). A RE-RUN of `db:apply-rls` on the step D
  database prints eight more, right after the first two, one for each form
  step D dropped, in this order:
  `message: 'function public.app_client_code_check(uuid,uuid,uuid,text,text,text) does not exist, skipping',`,
  `message: 'function public.app_home_contract_sections_by_token(text,pg_catalog.int4) does not exist, skipping',`,
  `message: 'function public.app_home_contract_section_lines_by_token(text,uuid,pg_catalog.int4) does not exist, skipping',`,
  `message: 'function public.app_home_code_issue_by_token(text,uuid,text,text,text,text,text) does not exist, skipping',`,
  `message: 'function public.app_home_contract_ack_by_token(text,uuid,uuid,text,text,text,text,text) does not exist, skipping',`,
  `message: 'function public.app_home_variation_respond_by_token(text,uuid,text,uuid,text,text,text,text) does not exist, skipping',`,
  `message: 'function public.app_home_claim_request_by_token(text,uuid,uuid,text,text,text,text,text) does not exist, skipping',`
  and `message: 'function public.app_home_claim_design_payment_by_token(text,text,uuid,text,text,text,text,text) does not exist, skipping',`.
  (The forward-again of undo (0) prints only the four: undo puts the old
  forms back.)

Only a line that starts `Migration failed:` or `apply-rls failed:` is a
failure (after one, npm adds `npm error` lines of its own; they only repeat
that the command failed). Expected:

- `db:migrate` exits 0 and prints `Migrations applied.`. It does not print a
  count, so run step 4 (a): `migrations` is exactly one higher (67).
- `db:apply-rls` exits 0 and ends with two lines: the first starts
  `apply-rls: verified in the catalogues` and goes on
  `66 tables, 81 policies, 36 triggers, 102 functions, RLS forced on all of them, role metra_app present.`
  (step C's said 100 functions: step D adds two); the second starts
  `apply-rls: grants verified` and is word for word step C's step 3 line
  (`... 24 narrowed table(s) ... client_verification_codes readable on every column but code_hash; no truncate, references, trigger for metra_app on any table; no policy outside the manifest.`).
  If that second line is replaced by a problem list, it exits 1: something
  was added by hand. Do not merge; tell the lead.
- `assert-schema-applied` exits 0 and prints six lines, each starting
  `assert-schema-applied:`, in this order: `OK` then `66 declared table(s), every column present.`;
  `indexes` then `151 declared, all present.`; `constraints` then
  `413 declared, all present.`; `functions` then `102 declared, all present.`;
  `orphaned org rows` then
  `58 org-scoped table(s) answered, none holds a row whose org_id names no organization.`;
  and `composite set-null FKs` then
  `16 found (16 declared in src/schema/), every one narrowed to a single non-org_id column.`

**A lock race in `db:apply-rls` is retried for you.** A line like
`apply-rls: policies/36-client-home.sql rolled back with SQLSTATE 55P03 on attempt 1 of 3 (a lock race with live traffic); trying it again in 2 s.`
followed by `Applying policies/36-client-home.sql ... (attempt 2 of 3)` is
NOT a failure: that one file rolled back whole and is being applied again (3
attempts, 2 s then 4 s apart). Carry on reading the output.

**If a command fails, it prints the SQLSTATE and what to do,** on two lines:

- `Migration failed: SQLSTATE 55P03: 0066: could not take every lock within 3 s (stopped at public.client_verification_codes:SHARE)`
  (or `(stopped at public.design_engagements:ACCESS EXCLUSIVE)`) then
  `Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).`
  The migration takes its two locks with NOWAIT (see *Locks*), tries again
  every 10 to 40 ms for 3 s in all, and holds nothing while it tries, so no
  request waited on it. The table named is the one a long transaction held
  for those 3 s. Re-run the block a little later.
- `apply-rls failed: SQLSTATE 55P03: canceling statement due to lock timeout`
  (or `SQLSTATE 40P01: deadlock detected`) then
  `apply-rls failed: lock wait or deadlock, safe to re-run at a quieter moment (this file rolled back; the files before it stay applied).`
  That means the same file lost three times in a row: a studio transaction or
  report held what it needed for more than 3 s (a 40P01 is ordinary studio
  traffic; step B's runbook says why). **Run `npm run db:apply-rls` again, and
  keep re-running it until it exits 0** (wait a minute between runs; it is
  safe, every statement is idempotent), then
  `npm run assert-schema-applied -w @metra/db`. In between, step 2 (b) may
  read `1, 1, 5, 0` (`functions/75-client-home.sql` runs before the policy
  files, so the new forms are in while a later file lost its race): the
  current site works on that, as it calls none of those forms, and a run that
  exits 0 changes nothing more in step D's objects.
- `Migration failed: SQLSTATE 42701: column "client_codes_reset_at" of relation "design_engagements" already exists`
  (or `SQLSTATE 42P07: relation "client_verification_codes_unused_created_idx" already exists`)
  then `Migration failed: tell the lead before running anything else (the whole batch rolled back, nothing was changed).`:
  part of step D is already in this database, which step 2 (b) would have
  shown. Nothing changed; tell the lead.
- Any other code ends `tell the lead before running anything else`.

**Safe to re-run.** `db:migrate` records 0066 only when it commits, so after
any failure a re-run starts again from 0065; after a success it finds nothing
pending and prints `Migrations applied.` again. Every statement under `rls/`
is idempotent: a second `db:apply-rls` prints the same two verified lines
(its notices are under step 3). `assert-schema-applied` only reads.

**Locks.** `db:migrate` runs 0066 as ONE transaction. It first takes ACCESS
EXCLUSIVE on `design_engagements` (for its new column: every delivery read
waits) and SHARE on `client_verification_codes` (reads go on, writes wait),
each with NOWAIT, within one 3 s budget for all its attempts: if a table is
busy it releases what it took, sleeps 10 to 40 ms and tries again, so it
never queues behind a page read or a code act (and never makes the next ones
queue behind it). Then it adds the column (no default: catalogue only, no row
is rewritten) and builds the index. Not `CONCURRENTLY`: `db:migrate` runs a
migration inside a transaction, where a concurrent index build cannot run,
and the codes table is empty in production (step 2 (c)), so the whole
migration takes milliseconds. Nothing in the current site writes the codes
table. `db:apply-rls` re-creates the code functions in
`functions/75-client-home.sql` (a DROP of each old form and a CREATE of each
new one: no table lock) and runs every other file as it always does (the
worst cases in step B's runbook are unchanged); a file that loses a lock race
is tried again (above).

**4. Read-only, after: expected results.** Each block ON ITS OWN.

(a) Step 2 (a) again: `migrations` 67, `newest` 1793044397504 (0066's journal
stamp).

(b) Step 2 (b) again: now `step_d_index` 1, `reset_column` 1,
`step_d_functions` 5 and `step_c_functions` 0.

(c) The new index is valid and partial, the new and changed functions are the
definers `metra_app` may call and nobody else, and the internal code check is
callable by nobody: one row, `valid_index` 1, `definers` 9, `app_execute` 9,
`others_execute` 0, `check_callable` 0.

```sql
-- Step D step 4 (c): the index and who may call the new and changed functions. Run this one alone.
select
  (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'client_verification_codes_unused_created_idx' and i.indisvalid
      and pg_get_indexdef(i.indexrelid) like '%WHERE ((consumed_at IS NULL) OR (result_ref = id))') as valid_index,
  count(*) filter (where p.prosecdef) as definers,
  count(*) filter (where has_function_privilege('metra_app', p.oid, 'execute')) as app_execute,
  count(*) filter (where exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                      or coalesce((select bool_or(has_function_privilege(r.oid, p.oid, 'execute')) from pg_roles r
                                    where r.rolname in ('anon', 'authenticated', 'service_role')), false)) as others_execute,
  (select count(*) from pg_roles r
    where r.rolname in ('metra_app', 'anon', 'authenticated', 'service_role')
      and has_function_privilege(r.oid, to_regprocedure('public.app_client_code_check(uuid, uuid, text, text, text)'), 'execute')) as check_callable
from pg_proc p
where p.oid in (to_regprocedure('public.app_home_code_issue_by_token(text, text, text, text, text, text)'),
                to_regprocedure('public.app_home_code_unsent_by_token(text, uuid)'),
                to_regprocedure('public.app_client_codes_reset(uuid)'),
                to_regprocedure('public.app_home_contract_ack_by_token(text, uuid, text, text, text, text, text)'),
                to_regprocedure('public.app_home_variation_respond_by_token(text, uuid, text, text, text, text, text)'),
                to_regprocedure('public.app_home_claim_request_by_token(text, uuid, text, text, text, text, text)'),
                to_regprocedure('public.app_home_claim_design_payment_by_token(text, text, text, text, text, text, text)'),
                to_regprocedure('public.app_home_contract_sections_by_token(text, uuid, integer)'),
                to_regprocedure('public.app_home_contract_section_lines_by_token(text, uuid, uuid, integer)'));
```

(d) The code request's daily rule is the one in the database: one row,
`delivery_cap_10` true, `names_its_limit` true, `guess_sum_rule` false.

```sql
-- Step D step 4 (d): the code request's daily rule. Run this one alone.
select p.prosrc like '%having count(*) >= 10)%' as delivery_cap_10,
       p.prosrc like '%''delivery_day''%' as names_its_limit,
       p.prosrc like '%tries_since >= 50%' as guess_sum_rule
from pg_proc p
where p.oid = to_regprocedure('public.app_home_code_issue_by_token(text, text, text, text, text, text)');
```

(e) Step 2 (c) again: the same two numbers as before.

(f) Step 2 (d) again: `policies` 81 and `restrictive` 15.

(g) Step 2 (e) again: about the same size as before. Put the number in the
release note.

**Stop and do not go on** if any output in steps 3 or 4 differs from what is
written there. Tell the lead what you saw instead.

**5. Before the merge: the live site on the new database.** The site still runs
the current `main`. About five minutes, in your own studio only. Open the log
first, in a second window, and leave it open:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

Then, signed in to your own studio: open **Deliveries** (التسليمات) and a
delivery at the execution stage, an execution contract and its **Payments**
tab (الدفعات), and the dashboard. If a test project of yours has a delivery
link (`/d/...`) you sent to yourself, open it too (only look: do not say you
paid anything). Expected: every page loads and shows your data as before,
and the log shows no `42501`, no `42883`, no `MT100`, no `mutateInOrg failed`.

**If anything in step 5 fails:** do not merge. Run undo (0) below now, then
tell the lead what you saw. If everything passes, go straight to step 6.

**6. Then: merge, smoke test, return the checkout to main.**

1. Tell the lead steps 1 to 5 are done; the lead merges the branch and the
   Deploy workflow deploys it (the same evening).
2. Smoke test on your own studio, the log still open: the page loads of step
   5 again, now on the new code. Then, only if you have a test delivery link
   whose client email is an address you read, open its "I've made this
   payment" and press **Send the code** (أرسل الرمز). Expected: the code
   arrives, and its button opens the same payment with the code box already
   open (or, until the Resend sending domain is verified, the panel says the
   code could not be sent with a one-minute countdown, and the log shows one
   `client code email not sent:` line with `"statusCode":403`: that is the
   honest answer, not a failure of this step). Do not type the code: nothing
   is claimed. The log shows no `42883`, no `42501`, no `MT100` and no
   `mutateInOrg failed`.
3. Put the production checkout back on main:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach origin/main
```

**Undo, if ever needed.**

**(0) The database code, before the merge** (step 5 fails, or before the merge
the log shows a `42501`, a `42883` or an `MT100`, or a studio reports a broken
page). Two parts: the `db:apply-rls` of `main` (`bab6de80`, the database code
production ran on just before step 3: step C's), which puts back the code
functions as they were and the two contract page reads without the contract
id; then one SQL block that removes the forms that code does not know. It
leaves 0066 itself alone: the column (empty) and the index stay (neither
changes an answer). Use it only while the site still runs the code from
before the merge: if the new code is already deployed, undo (1) the code
first, then this.

From the copy you saved in step 1:

```powershell
cd C:\Users\HP\merta-main
git fetch origin
git switch --detach bab6de80
git log --oneline -1    # bab6de80 Merge remote-tracking branch 'origin/validate/home-h7-paper' into validate/release-h7p
npm run db:apply-rls
```

Run only `db:apply-rls` from this checkout, at a quiet hour as in step 3.
Expected: it exits 0; the four notices of step 3; and the two verified lines
of step C (`66 tables, 81 policies, 36 triggers, 100 functions ...` and the
grants line): that code declares 100 functions, and the new forms are extra
to it, not missing.

**If this `db:apply-rls` fails** with the two `apply-rls failed:` lines of step
3 (`SQLSTATE 40P01` or `55P03`), it is the same lock race with live traffic as
in step 3: **run `npm run db:apply-rls` again from this checkout, and keep
re-running it until it exits 0.** Any other code: stop and tell the lead.

Then, in the Supabase SQL editor, this block, on its own:

```sql
-- Step D undo (0), part 2: the forms main's code does not know. Run this one alone.
set lock_timeout = '3s';
drop function if exists public.app_home_contract_sections_by_token(text, uuid, integer);
drop function if exists public.app_home_contract_section_lines_by_token(text, uuid, uuid, integer);
drop function if exists public.app_home_code_issue_by_token(text, text, text, text, text, text);
drop function if exists public.app_home_code_unsent_by_token(text, uuid);
drop function if exists public.app_client_codes_reset(uuid);
drop function if exists public.app_client_code_check(uuid, uuid, text, text, text);
drop function if exists public.app_home_contract_ack_by_token(text, uuid, text, text, text, text, text);
drop function if exists public.app_home_variation_respond_by_token(text, uuid, text, text, text, text, text);
drop function if exists public.app_home_claim_request_by_token(text, uuid, text, text, text, text, text);
drop function if exists public.app_home_claim_design_payment_by_token(text, text, text, text, text, text, text);
```

Expected: `Success. No rows returned`. If it fails with `canceling statement
due to lock timeout`, nothing was dropped: run it again a minute later. Then,
read-only, each block ON ITS OWN: step 2 (b) again (now `step_d_index` 1,
`reset_column` 1, `step_d_functions` 0, `step_c_functions` 3: the index and
the column stay, the rest is as before step 3) and step 2 (d) again (81 and
15). Then step 5 again: everything works as it did before step 3. Put the
checkout back on main (step 6 (3)) and tell the lead what failed the first
time. Do not merge. If step 5 STILL fails after undo (0), the database code
was not the cause: tell the lead at once and run nothing else.

To go forward again later, only when the lead says so: step 1 again, then
from step 3 only `npm run db:apply-rls` and, if it exits 0,
`npm run assert-schema-applied -w @metra/db` (0066 is still applied, so
`db:migrate` is not needed; if you run it anyway it prints
`Migrations applied.` and changes nothing):

```powershell
npm run db:apply-rls
if ($LASTEXITCODE -eq 0) { npm run assert-schema-applied -w @metra/db }
```

Expected: the four notices of step 3 (undo put the old forms back, so their
DROPs print nothing), the two verified lines and the six
`assert-schema-applied` lines of step 3 (re-run until it exits 0, as step 3
says); then step 4 and on.

**(1) The code** (a page fails after the deploy): from
`C:\Users\HP\merta-main\apps\web`, `npx wrangler rollback <version-id>` with
the version that served before the merge (`npx wrangler deployments list`).
Leave the database alone: the older Worker runs on it (see THE ORDER).

**(2) The column and the index:** never needed (neither changes an answer).
If the lead ever wants them gone, it is a new migration, never a hand edit
here.

**Rehearsed** (the H5 fix round, Oct 27). Every command and SQL block above
was run as written, at `52ac1ae4` (the branch at `209e8057`, this runbook
before this note), on a local PostgreSQL 17 database (UTF8) built in
production's own order: Supabase's API roles and default grants simulated
first; then `main`'s database code at `0f9cb2db` (`db:migrate`,
`db:apply-rls`, `seed`); DB step S from `992bca1e`; DB step B's
`db:apply-rls` from `65c78473`; DB step C from `bab6de80` (`npm ci`,
`db:migrate`, then `main`'s own `db:apply-rls`) and `assert-schema-applied`;
then data written by `main`'s own cores (three studios: deliveries at every
execution stage, a client's claim, change orders approved, internal and
expired, a final account, a termination, contracts no delivery stands behind)
and a bulk of ten studios: 2,023 contracts, 21 deliveries, 66 migrations, no
code. The runs used a fresh clone standing in for `merta-main` (its own
`npm ci`, `origin` on GitHub): the PowerShell cut from this section with
three substitutions only (the checkout path, the Desktop path, and the
connection set in the session in place of `.env`), the SQL from the saved
copy, each block on its own.

- Steps 1 to 4 printed exactly what they say. Step 1's guards printed only the
  `docs/DEPLOY.md` line and the three 0066 files, and the saved copy equals
  the branch's runbook (line endings aside). Step 2 read 66 and
  1792976742588; 0, 0, 0 and 3; 0 and 0; 81 and 15; 35 MB. Step 3 printed the
  two migrate notices, the four apply-rls notices, the two verified lines
  (102 functions) and the six `assert-schema-applied` lines, and exited 0.
  Step 4 read 67 and 1793044397504; 1, 1, 5 and 0; 1, 9, 9, 0 and 0; true,
  true and false; 0 and 0; 81 and 15; 36 MB.
- A catalogue comparison (every function body with its settings and grants,
  policy, trigger, table and column grant, constraint, index and RLS flag)
  from step C to step D found exactly the changes under *What it changes*:
  nine function forms gone (the code request, the code check, the four acts,
  the two page reads, and the guard trigger's old body) and eleven present
  (their new forms, the new guard body, `app_home_code_unsent_by_token` and
  `app_client_codes_reset`), the grants `metra_app` only and the code check
  nobody's; the new column under the table's existing grants (`metra_app`
  SELECT and INSERT, Supabase's `service_role` as on every column, no UPDATE
  for `metra_app`); one index; nothing else.
- A second step 3 printed `Migrations applied.`, the four notices and the
  eight `does not exist, skipping` ones in the order step 3 lists them, the
  same verified and `assert-schema-applied` lines, and changed nothing in the
  catalogue.
- **The migration's lock race, on purpose.** A writer holding the codes table
  (ROW EXCLUSIVE, an open insert) for 10 s against step 3: the two 55P03
  lines naming `public.client_verification_codes:SHARE`, exit 1, nothing run
  after them; step 2 (a) still 66, step 2 (b) still 0, 0, 0 and 3. The block
  run again after the writer ended applied 0066 and printed what step 3 says.
- **apply-rls's lock race, on purpose.** A reader holding the codes table for
  30 s while step 3 ran: 0066 applied, then `policies/36-client-home.sql`
  lost three times (55P03, retried after 2 s and 4 s), the two failure lines,
  exit 1, `assert-schema-applied` skipped; in between, step 2 (b) read 1, 1,
  5 and 0. `db:apply-rls` then `assert-schema-applied` run again after the
  reader ended exited 0 (the four notices and the eight skipping ones), and
  the catalogue was identical to a clean run's.
- **Undo (0)**, from the saved copy: `bab6de80`'s `db:apply-rls` printed the
  four notices and step C's two verified lines (100 functions), and exited 0;
  part 2 returned no rows; step 2 (b) read 1, 1, 0 and 3, step 2 (d) 81 and
  15; and the catalogue equalled step C's but for the column and the index
  0066 keeps.
- **Forward again** (step 1, then the forward-again block: `db:apply-rls`,
  then `assert-schema-applied`): the four notices, the two verified lines and
  the six `assert-schema-applied` lines of step 3, exit 0; step 2 (b) 1, 1, 5
  and 0, step 4 (c) and (d) as before, 81 and 15; and a catalogue identical
  to the first forward's. Step 6 (3) then put the checkout back on `main`.
- **The current code on the step D database:** `main`'s (`bab6de80`) own
  isolation gate passed 60 of 60, and its action tests 1,762 of 1,814, on a
  copy of this step D database. Every one of the 52 failures is a test of the
  database objects step D changes, not of an app path: 50 call the code
  request, the four code acts or the two page reads directly in SQL in their
  old forms (42883: the forms step D drops, which no code on `main` calls) or
  pin the list and the count of those functions; one runs `main`'s own
  `roles.sql`, which grants on the old forms (42883); and one fails the same
  way on the step C database (checked again on a copy of it: it checks a
  Supabase default grant that the simulated roles add and `roles.sql` does
  not manage). No contract, change
  order, delivery, payment, claim, final account or measurement test of the
  shipped code failed.
- **This branch's own tests** on a fresh database replayed as CI builds it:
  the isolation gate passed 60 of 60 and the action tests 1,858 of 1,858.

## Monthly market bulletin

Once 0061 is applied and the branch is merged, every month's ministry
bulletin goes through the same steps. A Claude Code session reads the data;
the repo's `market:*` commands are the gate; you approve. Nothing here calls
an API or needs a key.

**Two places, kept apart on purpose.** The bulletin is third-party content,
and a session that reads it must never hold a database credential.

- **The extraction checkout** `C:\Users\HP\metra-bulletins`: a plain clone
  with NO `.env`. Create it once: `git clone https://github.com/nabilhakeem22/Metra.app C:\Users\HP\metra-bulletins`,
  then `cd C:\Users\HP\metra-bulletins` and `npm ci`. Each month,
  `git fetch origin` and `git switch --detach origin/main` there first. The
  session runs ONLY here, and only `market:check --offline`.
- **The production checkout** `C:\Users\HP\merta-main`, where you run the
  database steps. The `market:*` commands read ONLY `MARKET_DATABASE_URL`
  (never `DATABASE_URL` or the `.env`), so in the PowerShell window you use
  for them, set it by hand from the `.env`'s `DATABASE_URL` line:
  `$env:MARKET_DATABASE_URL = '<the DATABASE_URL value>'`. It lives only as
  long as that window. Never set it in the session's shell.
- **One staging folder both use:** `C:\Users\HP\market-staging`. In every
  window: `$env:MARKET_STAGING_DIR = 'C:\Users\HP\market-staging'`.

**1. Put the files in one place**, e.g.
`C:\Users\HP\market-bulletins\2026-07\bulletin-2026-07.pdf` and, if you have
it, the MD conversion beside it.

**2. Write the catalogue** (production checkout, with `MARKET_DATABASE_URL`
set): `npm run market:catalogue`. It writes
`C:\Users\HP\market-staging\catalogue.json`, the published keys the session
reuses.

**3. Start a Claude Code session in `C:\Users\HP\metra-bulletins` and paste,
with your paths and period:**

```text
Read docs/market-price-book/EXTRACTION.md, then extract
C:\Users\HP\market-bulletins\2026-07\bulletin-2026-07.pdf
(and C:\Users\HP\market-bulletins\2026-07\bulletin-2026-07.md) for period 2026-07.
The staging folder is C:\Users\HP\market-staging (set MARKET_STAGING_DIR to it);
its catalogue.json holds the keys to reuse. Write part files under
C:\Users\HP\market-staging\2026-07\parts, run npm run market:check -- --period 2026-07
--offline --pdf <the PDF> --md <the MD>, fix what you can, and hand me the confirm list.
You have no database access and need none. Never edit anything under packages/, and
never run market:publish.
```

**4. Clear the confirm list.** For each row the session lists, open the PDF
page it names and record the answer in `C:\Users\HP\market-staging\2026-07\`:
`corrections.json` for a value (`[{ "rowId": "p11.r1", "month": 7, "value":
"30.455", "reason": "PDF page 11" }]`; `"value": null` for a cell the page
shows empty) and `mapping.json` to `map` a row to an existing key, `skip` it
(with a reason; review.html lists every skipped row), or `discontinue` an old
key.

**5. Review** (production checkout, `MARKET_DATABASE_URL` set). Always online
and always with the source files: publish accepts nothing else.

```powershell
npm run market:review -- --period 2026-07 --pdf C:\Users\HP\market-bulletins\2026-07\bulletin-2026-07.pdf --md C:\Users\HP\market-bulletins\2026-07\bulletin-2026-07.md
```

It refuses to run if the gate code (`packages/market-ingest`, `packages/db/src`)
differs from the checked-out commit. Open
`C:\Users\HP\market-staging\2026-07\review.html` and read it top to bottom:
the header must say "Nothing blocks" and name the gate commit; the flags, the
skipped rows, the per-category diff, the item details that change and the new
items are yours to judge. The command prints `extraction_sha256 = <64
characters>`: that hash is what you approve.

**6. Publish**, with that hash and the same source files:

```powershell
npm run market:publish -- --period 2026-07 --approve <extraction_sha256> --reviewer "Nabil Hakeem" --pdf C:\Users\HP\market-bulletins\2026-07\bulletin-2026-07.pdf --md C:\Users\HP\market-bulletins\2026-07\bulletin-2026-07.md
```

Publish re-runs the gate inside its transaction and writes only what it
computes, so a `staged.json` edited after the review is never published. It
refuses (exit 1, `market:publish FAILED: ...`, nothing written) if the files,
the overrides, the published history or the gate changed since the review,
if the review ran `--offline`, if anything blocks, or if 2026-07 is already
published (add `--replace` to withdraw that one in the same transaction; the
corrected names then replace the old ones). On success it prints the bulletin
id, the counts and the gate commit. Rehearsed on July 2026 (456 rows, the four
p97 rows skipped by the owner): 63 categories, 456 items, 3181 observations,
about 2.6 s locally. Then archive `C:\Users\HP\market-staging\2026-07\` with
the PDF.

**Withdraw** a published bulletin (production checkout, `MARKET_DATABASE_URL`
set). Its months fall back to the previous bulletin at once, with no deploy;
the items it discontinued are active again, and the names it printed revert
to the previous bulletin's:

```powershell
npm run market:withdraw -- --period 2026-07 --reason "wrong file"
```

**If a publish or a withdraw says `SQLSTATE 55P03`,** another session holds
the market locks for more than 3 s. The message lists each holder: its pid,
its application (`metra-market-cli` for the market commands), its state, how
long its transaction has been open (or, with none open, how long it has been
idle), and `running, wait for it` or `LEFT BEHIND, end it`. End a LEFT
BEHIND one in the SQL editor with `select pg_terminate_backend(<pid>);` and
run the command again. LEFT BEHIND is an idle session with no transaction
open (it can hold the lock only at session level, which no market command
takes any more, and no timeout ends it: a SQL editor tab, or a seed run from
before this change) or a transaction idle in its current state for more
than 60 s. A holder running a statement is never LEFT BEHIND, however old
its transaction: a publish may take up to 300 s. Only the market locks are
listed, never another advisory lock on the database. A publish or
withdraw transaction can never stay open longer than 300 s (the
`transaction_timeout` it sets), or 60 s idle; a studio's seed transaction 30 s
idle.

## Seeding studio price books from the market book

An owner step, once the branch carrying it is merged: it fills the price books
of the studios you name with `--org` from the PUBLISHED market book (a new
studio gets it at sign-up on its own: *0062 and the market price book at
sign-up*). Run it from the production checkout on an
up-to-date `main`, in a PowerShell window where you set
`$env:MARKET_DATABASE_URL` (as in *Monthly market bulletin*; the command reads
nothing else).

**What it creates, per studio.** Nothing a studio already has is changed or
deleted; anything that would clash is skipped and counted.

- **Sections:** one per market sub-category that gets at least one item, named
  as the sub-category («الزجاج» / "Glass"). When a studio section already has
  that name, the new one carries its category too («الجبس (الخامات الأساسية)»
  / "Gypsum (Basic materials)", next to the studio's own "Gypsum"); when even
  that name is a studio section's, the items go into that section and none is
  created. Each new one is marked `sections.key = market.<sub-category>`, so a
  re-run finds it.
- **Items:** one cost item per market item a published bulletin prices:
  - the name and spec, and a roll's pack unless the text already says roll
    («أسلاك نحاس معزول 2 مم لفة 100 م»). Names are unique within the seed: two
    items that would read alike carry their sub-category (the 23 standard and
    flexible-joint clay pipes and fittings: «كوع فخار 150 مم (مواسير صرف فخار
    بوصلات مرنة)»). A spaced hyphen copied from the bulletin becomes a comma in
    Arabic; a range inside a spec stays («سمك 4مم-6مم», «كثافة 600-700»);
  - the studio unit (sqm, linear_meter, pcs, kg, ton, liter, cbm, roll);
  - code `MKT-<market key>` (e.g. `MKT-raw.steel.rebar`);
  - cost = the newest published month with a numeric price (a suspended or
    empty month is skipped for the one before it);
  - price = cost x 1.05, half up at 4 decimals;
  - `market_item_id` set, active.
- **Skipped, with a count each:** already linked to that market item (so a
  re-run creates nothing), discontinued, no studio unit (bag, pack,
  thousand_bricks), no price, a studio item with the same code, a studio item
  of the studio's OWN with the same name (compared ignoring case, spacing,
  invisible marks and the Arabic spellings typed interchangeably; the seed's
  own items never count, so a re-run after a partial undo re-seeds).
- **Audit:** a `create` row per section and per item, as the app writes them,
  marked `source: market:seed-price-books`. The actor is the studio's earliest
  owner (else its earliest admin), as for the app's automation. A studio with
  neither is skipped and named. The app seeds with the same code: a studio
  seeded at sign-up gets the same rows, marked `market:seed-on-signup`, and
  one loaded from its empty price book `market:seed-from-price-book`.

**One transaction per studio.** A studio is seeded completely or not at all.
One studio's failure (say a code typed in the same second) undoes nothing
for another. Each transaction holds one studio's rows for about a second.
Re-running retries exactly the failed studios and creates nothing twice. It
runs as `metra_app` in that studio's org context, so RLS, every foreign key
and every CHECK apply as for the app.

**1. Dry run, and read it.**

```powershell
npm run market:seed-price-books -- --dry-run
```

It writes nothing. A local copy shaped like production (July 2026 published,
two studios with the default sections) printed:

```text
DRY RUN, nothing is written. 456 published market item(s); 2 studio(s).
studio "Org A Fit-out" (00000000-0000-4000-8000-00000000000a)
  actor 00000000-0000-4000-8000-0000000000a1 (owner)
  sections: to create 55, already present 0 (1 named with their category, the plain name being taken)
  items: to create 447, skipped 9
    already linked 0, discontinued 0, unit unsupported (bag, pack, thousand_bricks) 9, no price 0, code clash 0, name clash 0
studio "Org B Fit-out" (00000000-0000-4000-8000-00000000000b)
  ...
totals: sections to create 110, items to create 894, studios failed 0
```

Check each studio's line before going on, and note the ids of the studios to
seed: a real run ALWAYS names them.

**2. The real run, for the studios you named.** Never run it without
`--org`: a bare real run seeds EVERY studio, test studios included. Try one
first, then the rest (repeat `--org`):

```powershell
npm run market:seed-price-books -- --org <studio id>
npm run market:seed-price-books -- --org <studio id> --org <studio id>
```

The same lines with `created` in place of `to create`. Before it seeds, a
real run also rebuilds the seed book new studios are seeded from (*0062 and
the market price book at sign-up*); it holds that book only inside each
studio's transaction, never between studios, so a dropped connection leaves
no lock behind. A publish or withdrawal during the run makes it stop at the
next studio: `STOPPED, nothing written for this studio: the market price book
changed during this run`, the studios after it `not reached`, exit 1; run the
same command again. A connection lost mid-run (a dropped link) stops it the
same way at the studio it was on (`CONNECTION LOST on this studio`), with the
totals; that studio is written only if its commit had reached the database,
and a re-run completes it. A dry run rebuilds nothing. Exit 0, or exit 1
with `FAILED, nothing written for this studio: SQLSTATE <code>: <the database's
reason>` on each studio that failed (the others are seeded), e.g. `SQLSTATE
55P03: canceling statement due to lock timeout` when a studio was saving the
same item at that moment: run the same command again. An `--org` id may be
typed in either case. A second run
prints `created 0` and every item `already linked`.

**Undo, if ever needed.** Read first (SQL editor, run it alone): each studio's
seeded items, and how many are still removable (never edited, and in no
proposal, BOQ, contract, variation or bulk price change).

```sql
-- Seeded price-book items per studio, and how many are still removable. Read-only.
select o.id as studio_id, coalesce(o.name_en, o.name_ar) as studio, count(*) as seeded_items,
       count(*) filter (
         where c.updated_at = c.created_at
           and not exists (select 1 from proposal_lines l where l.cost_item_id = c.id)
           and not exists (select 1 from boq_lines l where l.cost_item_id = c.id)
           and not exists (select 1 from contract_lines l where l.cost_item_id = c.id)
           and not exists (select 1 from variation_order_lines l where l.cost_item_id = c.id)
           and not exists (select 1 from price_change_lines l where l.cost_item_id = c.id)
       ) as removable
  from cost_items c join organizations o on o.id = c.org_id
 where c.market_item_id is not null and c.code like 'MKT-%'
 group by o.id, o.name_en, o.name_ar
 order by 2;
```

Then this ONE block deletes only the removable seeded items, and the seed's
sections left empty; a studio's own items and sections are never touched
(they carry no `MKT-` code and no `market.` key). To undo ONE studio, add
`and c.org_id = '<studio id>'` to the first `where` AND
`and s.org_id = '<studio id>'` to the second, or another studio's empty
seeded section goes too. The
audit rows stay (the audit trail is append-only). Rehearsed: of 894 seeded
items, the one edited after seeding stayed with its section, and every other
seeded item and section went; the default sections and the studios' own items
were untouched.

```sql
-- Undo the price-book seed: removable seeded items, then empty seeded sections. ONE transaction.
begin;
delete from cost_items c
 where c.market_item_id is not null and c.code like 'MKT-%'
   and c.updated_at = c.created_at
   and not exists (select 1 from proposal_lines l where l.cost_item_id = c.id)
   and not exists (select 1 from boq_lines l where l.cost_item_id = c.id)
   and not exists (select 1 from contract_lines l where l.cost_item_id = c.id)
   and not exists (select 1 from variation_order_lines l where l.cost_item_id = c.id)
   and not exists (select 1 from price_change_lines l where l.cost_item_id = c.id);
delete from sections s
 where s.key like 'market.%'
   and not exists (select 1 from cost_items c where c.section_id = s.id);
commit;
```

## Rolling back

**The lever is `wrangler`, not git.** A git revert has to go through CI and a
rebuild before it changes anything a user sees; a Worker rollback is immediate
and needs no build.

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler deployments list              # the 10 most recent deployments; Created is UTC
npx wrangler rollback <version-id>         # roll back to THAT version (the id under "Version(s):")
```

`<version-id>` is the id printed after `(100%)` under `Version(s):` in the
list. **Never run `npx wrangler rollback` without an id after 0060:** it does
not ask, it picks the deployment before the current one, and that may be
below the rollback floor (*0060 and the Round E database step*, step 2 (f)).

Three things a rollback does NOT undo, and they are the reason the pre-merge
database step exists:

- **Migrations.** A rolled-back Worker runs older code against the newer schema.
  Additive, nullable migrations are safe in that direction by construction, which
  is why every migration in this repo is additive - a column the old code does
  not know about is a column it never selects.
- **`apply-rls` changes.** Policies, grants and triggers are applied out of band
  and stay applied. Each of them has a one-line revert, which belongs in the wave
  report that introduced it.
- **Worker secrets.** `wrangler rollback` restores code, not secrets. A rotated
  secret stays rotated.

**Round B (0056) specifically:** roll back the Worker and leave the database
alone. Any Worker version runs on the Round B database (the nonce trigger
covers older code's rotate and revoke). Running `db:apply-rls` from an older
`main` is NOT an undo while PR-B9-or-later code serves: it drops `token_nonce`
from the UPDATE grant and that code's revoke fails with 42501. The order, and
the one case where dropping the two new functions is allowed, are under *0056
and the Round B database step*, "Undo, if ever needed".

**PR-B12 (0057) specifically:** the same. Roll back the Worker, leave the
database alone, and never run `db:apply-rls` from an older `main` while B12
code serves (*0057 and the B12 database step*, "Undo, if ever needed").

**Round C (0058) specifically:** the same. Roll back the Worker, leave the
database alone, and never run `db:apply-rls` from an older `main` while C7 or
later code serves (*0058 and the Round C database step*, "Undo, if ever
needed").

**Round D (0059, Wave 3) specifically:** the same. Roll back the Worker, leave
the database alone, and never run `db:apply-rls` from an older `main` while
Wave 3 code serves (*0059 and the Round D database step*, "Undo, if ever
needed"; the smoke test is under *Round D Wave 3*).

**Round E (0060) specifically: a rollback FLOOR.** 0060 drops the
six-argument respond function, so once it has run, `npx wrangler rollback
<version-id>` may only be given the floor version
`85fe5e0b-b59f-4a2b-bc4a-0dcbe6078627` (the Round D Wave 3 deploy of main
`43f06c4`, created 2026-10-12T00:35 UTC) or a later one: the ids written down
in step 2 (f) of *0060 and the Round E database step*. Never run it without an
id. An older version answers 42883 on every review act on the client page.
Leave the database alone, and never run `db:apply-rls` from a tree older than
`validate/round-e-db`: it would re-create the six-argument function.

**The market price book (0061) specifically: a floor that arrives with the
first new unit.** The 0061 database itself sets none: every Worker version
runs on it (it only adds), so roll back the Worker and leave the database
alone. But the code before this merge knows only five units. Once any studio
has SAVED a cost item, a BOQ, proposal, contract or variation line in kg,
ton, liter, cbm or roll, a Worker rolled back below the market price book
deploy cannot save that row again (its validation refuses the unit) and shows
the unit's code instead of its name. From that first save on, a rollback below
this deploy leaves those rows read-only and unlabelled: treat that deploy as
the floor. Before the first such save, any version may serve. Check, read-only:

```sql
-- Rows in the five units the code before the market price book does not know.
select (select count(*) from cost_items where unit::text in ('kg','ton','liter','cbm','roll'))
     + (select count(*) from boq_lines where unit::text in ('kg','ton','liter','cbm','roll'))
     + (select count(*) from proposal_lines where unit::text in ('kg','ton','liter','cbm','roll'))
     + (select count(*) from contract_lines where unit::text in ('kg','ton','liter','cbm','roll'))
     + (select count(*) from variation_order_lines where unit::text in ('kg','ton','liter','cbm','roll')) as rows_in_new_units;
```

0 means the floor is not set yet. Withdrawing market data is not a rollback:
`market:withdraw` (*Monthly market bulletin*) takes effect at once, with no
deploy.

After rolling back, hit an authenticated page and watch `npx wrangler tail
metra-web` for `42501` (a missing grant), `MT100` (an immutability trigger) and
`42703` (`undefined_column` - the schema is behind the code, which means the
migration did not run).

## Testing against a database

The two DB suites (`npm run test:actions -w @metra/web`, `npm run test:isolation
-w @metra/db`) resolve `DATABASE_URL` from the repo-root `.env`, which holds the
**hosted Supabase** connection string. They are destructive: the action suite
creates and deletes whole organisations, the isolation suite creates and DROPS
scratch tables in `public`. Run as-is, they did that to the shared database —
and because teardown only ran from a suite's `afterAll`, every interrupted run
leaked its orgs. The shared project accumulated 480 of them.

So both vitest DB configs now call `assertLocalDatabase` (from
`packages/db/src/testing/local-database-guard.ts`) at config load, before a
single connection is opened. It **refuses to run unless `DATABASE_URL`'s host is
provably local** (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0` — exact matches, so
`localhost.attacker.example` does not count). A missing or unparseable URL is
refused too: it fails closed.

```
docker run --name metra-test-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:17
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
npm run db:migrate && npm run db:apply-rls && npm run db:seed
```

**CI is unaffected:** `ci.yml` exports `DATABASE_URL` pointing at its own
`postgres:17` service container, and `dotenv` never overrides an already-set
variable, so the guard sees `localhost` and passes.

**The opt-out** is `METRA_ALLOW_SHARED_DB=1`. Set it only when you mean to run a
destructive suite against a non-local database and you accept that it will
delete data there.

### Cleaning up fixture debris

Two one-off maintenance scripts, for the debris that leaked before the guard
existed. **Neither is part of CI and neither should be run casually.**

| Command | What it does |
|---|---|
| `npm run db:purge-fixture-orgs` | **Dry run by default.** Prints how many orgs are real, how many are fixture debris, how many are doomed, and the per-table row counts it would delete. |
| `npm run db:purge-fixture-orgs -- --execute --expect-real-orgs=<n>` | Performs the purge. `<n>` is the real-org count the dry run printed; if the database has changed underneath you, it refuses. It writes a `purge-fixture-orgs-<ts>.json` manifest (gitignored) before deleting anything, and re-checks the real-org count inside every transaction. |
| `npm run db:reindex-after-purge` | Rebuilds the indexes the debris bloated (`REINDEX ... CONCURRENTLY`, then `ANALYZE`). Run it after a purge. |

An org is doomed **only** if it and its account both carry a fixture name, the
account is not shared with another org, no member of it belongs to a real org or
to `auth.users`, and it is more than 24 hours old, so a run still in flight is
never touched.
