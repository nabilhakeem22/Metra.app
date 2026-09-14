import 'server-only';
// Runtime secrets, read at REQUEST TIME rather than built in.
//
// THE MECHANISM, STATED ACCURATELY. What bakes a value in is not `process.env`
// appearing in server code — it is a `.env*` FILE being present when the build
// runs. OpenNext's compile-env-files step reads those files and emits what it
// found into `.open-next/cloudflare/next-env.mjs`, which ships inside the Worker
// artifact. So the rule is "no .env* file in a CI/deploy build", and
// `scripts/assert-no-baked-secrets.mjs` is what enforces it on every build.
//
// A baked SUPABASE_SERVICE_ROLE_KEY — a full RLS bypass — would live in a build
// output, in CI logs if anything printed it, and in every deploy artifact, and
// rotating it would need a rebuild rather than a `wrangler secret put`.
//
// AT RUNTIME both readings work: a Worker's vars and secrets arrive on the
// per-request `env`, AND OpenNext's populateProcessEnv copies them into
// process.env at the start of each request. This helper reads the request env
// directly on Cloudflare because that is the source of truth rather than a copy
// of it — and because the name is a VARIABLE either way, which is the property
// that keeps a bundler from folding it into a literal.
import { cfEnv, isCloudflareRuntime } from './context';

/**
 * The value of secret `name` for THIS request, or undefined.
 *
 * On Cloudflare it comes from the Worker's own secrets via the request env. Off
 * platform — `next dev`, vitest, the migration scripts — it comes from
 * process.env, which is where a developer's .env actually is. Neither path is
 * build-time inlined, because the name is a variable: a bundler cannot fold
 * `env[name]` into a literal the way it folds `process.env.LITERAL`.
 *
 * Returns undefined rather than throwing. Whether a missing secret is fatal is
 * the caller's decision and differs: the service-role key is required and must
 * fail loudly, while the email keys being unset is a supported configuration
 * that degrades to "no email sent".
 */
export function runtimeSecret(name: string): string | undefined {
  if (isCloudflareRuntime()) {
    const value = (cfEnv() as unknown as Record<string, unknown>)[name];
    return typeof value === 'string' && value !== '' ? value : undefined;
  }
  const value = process.env[name];
  return value !== undefined && value !== '' ? value : undefined;
}
