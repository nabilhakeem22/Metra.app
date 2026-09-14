import 'server-only';
// Runtime secrets, read at REQUEST TIME rather than built in.
//
// THE PROBLEM THIS SOLVES. On Cloudflare, `process.env.X` written in server code
// is resolved by the bundler at BUILD time: OpenNext emits the value it saw into
// `.open-next/cloudflare/next-env.mjs`, and it ships inside the Worker artifact.
// For a public var that is intended. For SUPABASE_SERVICE_ROLE_KEY — a full RLS
// bypass — it means the secret lives in a build output, in CI logs if anything
// prints it, and in every deploy artifact, and rotating it needs a rebuild
// rather than a `wrangler secret put`.
//
// A Worker's real secrets are not in process.env at all: they arrive on the
// per-request `env`. Reading them from there keeps them out of the bundle
// entirely, which is what `scripts/assert-no-baked-secrets.mjs` then enforces
// on every build.
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
