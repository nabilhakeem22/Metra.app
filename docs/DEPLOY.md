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

The deploy job runs only for a CI run that was a **push to `main` of this
repository**. A pull request never deploys, whatever its branch is called: a
fork's branch named `main` would otherwise match the workflow's branch filter
and bring its own `ci.yml`. Its first step also refuses any commit that is not
the **current tip of `main`**, so re-running an old CI run cannot put an older
build over a newer one; that run goes red instead. To put an older build back
on purpose, use `npx wrangler rollback <version-id>` (*Rolling back*).

Both workflows run with a read-only GitHub token (`permissions: contents:
read`), and their two actions are pinned to a commit, with the tag in a
comment. When you move an action to a newer release, change the commit and the
comment together.

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
  Auth Site URL and redirect URLs. Add the new hostname to the Turnstile widget
  BEFORE switching (see "Go-live security", owner step 6).
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
- **`/api/*`** is outside the middleware, and stays outside it (Worker CPU).
  Every route handler there adds `x-content-type-options: nosniff` and
  `referrer-policy: no-referrer` to every answer itself, from the one constant
  in `src/lib/http/route-handler-headers.ts`; the PDF routes add
  `x-frame-options: SAMEORIGIN` to the document as well. A `referrer-policy`
  on a JSON answer does not change the policy of the page that fetched it, so
  the login rule below still holds.

**The CSP is two policies on purpose (owner decision D1).** The enforced one has
only the four directives that cannot break a Next app (`frame-ancestors 'none';
base-uri 'self'; object-src 'none'; form-action 'self'`). The full fetch policy
is `Content-Security-Policy-Report-Only`, with no report endpoint: a violation
only shows in the browser console. Once a console walk of every flow and a week
of real use show none, the follow-up moves it into the enforced header (one
constant plus the `_headers` line). Rolling back an enforced directive is the
same edit the other way. Only the login pages' Report-Only `script-src` and
`frame-src` name `https://challenges.cloudflare.com`: the sign-in Turnstile
widget's `api.js` and its iframe (`src/lib/auth/turnstile.ts`). They are static
assets, so the `/:locale/login` block of `public/_headers` detaches the `/*`
Report-Only policy and sets its own; every other page and asset omits the
origin.

**Never give the login pages `Referrer-Policy: no-referrer`.** Turnstile checks
the hostname that embeds the widget; the login keeps
`strict-origin-when-cross-origin` (the `/*` block of `public/_headers`).

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

#### Variables tab → New repository variable (7, plus 3 optional)

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
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | optional: the Turnstile SITE key (never the secret); blank = no widget. Once Supabase CAPTCHA is on it is REQUIRED: removing it stops every email sign-in |
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
procedure and its own rotation consequence: see [*0056 and the Round B database
step*](db-steps/0056-round-b.md) under Migrations.

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
- **Sign-in sends carry a Turnstile token** (security test T3), once the
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` Actions variable is set. The login page shows
  a Managed widget, interaction-only (most people see nothing), and each send
  (Resend included) takes a fresh single-use token. In a build with the
  variable our route refuses a send that carries no token (400 `malformed`,
  before the throttle and before Supabase), whatever Supabase's own CAPTCHA
  switch says; the form reads that as "refresh the page", which is the fix for
  a tab left open across the deploy that added the key. Otherwise the route
  only passes the token to
  Supabase (`options.captchaToken`); Supabase checks it with the secret key in
  its own dashboard, so a script calling Supabase's `/auth/v1/otp` directly is
  challenged too. The Worker holds no Turnstile secret and never calls
  siteverify. Supabase refusing the token answers `otp_captcha_failed`; a
  Turnstile outage fails CLOSED (the referenced `generic`), and signed-in
  sessions are unaffected. Verify sends no token: Supabase does not challenge
  it. Without the variable there is no widget, no script, and the send body is
  exactly what it was. The login page stays a static asset: the key is inlined
  into its client chunk at build time.
  **Local dev:** Cloudflare's always-pass test key `1x00000000000000000000AA`
  shows the widget locally, but once CAPTCHA is on in Supabase its dummy token
  is refused by the shared project. To sign in from `next dev` against the
  shared project, use the real site key with `localhost` added to the widget
  (owner decision D4).
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
6. **Turnstile (T3), in EXACTLY this order.** Enabling CAPTCHA in Supabase
   before the deploy, or shipping a build without the site key while it is on,
   stops every email sign-in.
   1. **Cloudflare dashboard, Turnstile, Add widget.** Name `Metra sign-in`.
      Hostnames: `metra-web.nabil-hakeem22.workers.dev` only (never
      `workers.dev` on its own; `localhost` only if you sign in from local dev,
      D4). Widget Mode **Managed**, Pre-clearance **No**, Create. Copy the
      **Site Key** and the **Secret Key** somewhere private. The secret goes
      ONLY into Supabase (step 6.5): never into GitHub, wrangler or a chat.
   2. **GitHub, the repo, Settings, Secrets and variables, Actions, Variables.**
      New repository variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = the **Site
      Key**. A secret-shaped value fails the build on purpose, naming the
      variable.
      If the build fails naming this variable, the **Secret** was pasted by
      mistake: the variable is stored in plain text and its value shows in the
      Actions logs, so treat the secret as burned. Delete the variable's value,
      rotate the secret key on the Turnstile widget (dashboard, the widget,
      Rotate secret key), paste the new secret into Supabase (step 6.5), then
      set the variable to the Site Key.
   3. **Merge and deploy the Turnstile PR.** Watch the deploy workflow go green.
   4. **Smoke test, CAPTCHA still OFF in Supabase:** open `/ar-EG/login` in a
      private window on a phone (or 390 px DevTools) and sign in end to end; in
      DevTools, Network, the `send` request body contains `captchaToken`;
      Console: no Turnstile error (code 110200 means the hostname is missing
      from the widget). Wait at least 10 minutes after the deploy before step
      6.5, so login tabs opened before it have reloaded.
   5. **Supabase dashboard, Authentication, Attack Protection** (older
      dashboards: Settings, Bot and Abuse Protection): Enable CAPTCHA
      protection, provider **Turnstile by Cloudflare**, paste the **Secret
      Key**, Save. No `wrangler secret put` is needed: the Worker never holds
      the secret.
   6. **(Optional, recommended) Custom SMTP (Resend)** in Supabase Auth, to lift
      the built-in mailer's 100 emails per hour (T3).
   7. **Smoke test, CAPTCHA ON:** email sign-in end to end in both locales
      (phone too, if SMS is on). The verify step must succeed. Then
      ```bash
      curl -s -X POST https://metra-web.nabil-hakeem22.workers.dev/api/auth/otp/send \
        -H "origin: https://metra-web.nabil-hakeem22.workers.dev" \
        -H "content-type: application/json" \
        -d '{"channel":"email","identifier":"<your address>"}'
      ```
      must answer `{"ok":false,"error":"otp_captcha_failed"}`, and no email
      arrives.
   8. **Rollback, if step 6.7 fails:** turn CAPTCHA OFF in Supabase (instant),
      and send the lead the exact failure (send or verify). Never remove the
      GitHub variable while CAPTCHA is on: that stops every email sign-in.
   9. **Custom domain, later:** add the new hostname to the same widget BEFORE
      switching DNS or `NEXT_PUBLIC_APP_URL`. The keys do not change and no
      redeploy is needed for Turnstile.
7. **Supabase Pro before the first paying studio.** On Free, 1 GB of storage and
   5 GB of egress are shared by every studio, and there is no per-studio quota
   yet.
8. **When a custom domain arrives** (its own PR): add the new hostname to the
   Turnstile widget BEFORE switching (step 6.9), then `workers_dev: false`,
   update `NEXT_PUBLIC_APP_URL` and the cron `APP_ORIGIN`, then the zone's HSTS,
   Always Use HTTPS and minimum TLS 1.2.

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

### Database step runbooks

Each database step has its own runbook under [`docs/db-steps/`](db-steps/). Every one of them
up to 0066 has been run: on 2026-11-13 production's migration ledger held 67 entries (0000 to
0066), the same 67 the journal held that day. The last row, 0067, has not been run yet. They
stay in the repository for three reasons: *Rolling back* below
points at their "Undo, if ever needed" parts, each one records what was measured on production
when it ran, and the 0059 and 0060 files hold SQL blocks that the test suites read
(`apps/web/tests/actions/runbook-sql.ts`, `packages/db/src/schema/organizations-checks.test.ts`).

| Step | Runbook |
|---|---|
| 0056, Round B (PR-B9) | [0056-round-b.md](db-steps/0056-round-b.md) |
| 0057, PR-B12 | [0057-b12.md](db-steps/0057-b12.md) |
| 0058, Round C | [0058-round-c.md](db-steps/0058-round-c.md) |
| 0059, Round D | [0059-round-d.md](db-steps/0059-round-d.md) |
| Round D Wave 3 deploy and smoke test (no migration) | [0059b-round-d-wave-3-smoke.md](db-steps/0059b-round-d-wave-3-smoke.md) |
| 0060, Round E | [0060-round-e.md](db-steps/0060-round-e.md) |
| 0061, market price book | [0061-market-price-book.md](db-steps/0061-market-price-book.md) |
| 0062, market price book at sign-up | [0062-market-book-at-sign-up.md](db-steps/0062-market-book-at-sign-up.md) |
| Rescue ledger and studio read budgets (PR BR) smoke test (no migration) | [0062b-rescue-ledger-smoke.md](db-steps/0062b-rescue-ledger-smoke.md) |
| 0063, Stage 2 DB step A (execution first release) | [0063-stage-2-step-a.md](db-steps/0063-stage-2-step-a.md) |
| 0064, site diary DB step S | [0064-site-diary-step-s.md](db-steps/0064-site-diary-step-s.md) |
| Stage 2 DB step B, the client "I paid" (apply-rls only, no migration) | [0064b-stage-2-step-b.md](db-steps/0064b-stage-2-step-b.md) |
| 0065, client home DB step C | [0065-client-home-step-c.md](db-steps/0065-client-home-step-c.md) |
| 0066, client codes DB step D | [0066-client-codes-step-d.md](db-steps/0066-client-codes-step-d.md) |
| 0067, security batch 3 (sign-in pause table, narrower grants, membership role writer) | [0067-security-batch-3.md](db-steps/0067-security-batch-3.md) |

A new database step gets a new file in that folder and a row in this table, not a section here.

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
below the rollback floor ([*0060 and the Round E database step*](db-steps/0060-round-e.md), step 2 (f)).

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
the one case where dropping the two new functions is allowed, are under [*0056
and the Round B database step*](db-steps/0056-round-b.md), "Undo, if ever needed".

**PR-B12 (0057) specifically:** the same. Roll back the Worker, leave the
database alone, and never run `db:apply-rls` from an older `main` while B12
code serves ([*0057 and the B12 database step*](db-steps/0057-b12.md), "Undo, if ever needed").

**Round C (0058) specifically:** the same. Roll back the Worker, leave the
database alone, and never run `db:apply-rls` from an older `main` while C7 or
later code serves ([*0058 and the Round C database step*](db-steps/0058-round-c.md), "Undo, if ever
needed").

**Round D (0059, Wave 3) specifically:** the same. Roll back the Worker, leave
the database alone, and never run `db:apply-rls` from an older `main` while
Wave 3 code serves ([*0059 and the Round D database step*](db-steps/0059-round-d.md), "Undo, if ever
needed"; the smoke test is under [*Round D Wave 3*](db-steps/0059b-round-d-wave-3-smoke.md)).

**Round E (0060) specifically: a rollback FLOOR.** 0060 drops the
six-argument respond function, so once it has run, `npx wrangler rollback
<version-id>` may only be given the floor version
`85fe5e0b-b59f-4a2b-bc4a-0dcbe6078627` (the Round D Wave 3 deploy of main
`43f06c4`, created 2026-10-12T00:35 UTC) or a later one: the ids written down
in step 2 (f) of [*0060 and the Round E database step*](db-steps/0060-round-e.md). Never run it without an
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
