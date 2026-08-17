import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * The Cloudflare Workers `env` for the current request — bindings (HYPERDRIVE,
 * BROWSER) and vars, as typed in `cloudflare-env.d.ts`.
 *
 * Only valid on the Cloudflare runtime. Off-platform (`next dev`, Node/Vitest,
 * `npm run migrate`) `getCloudflareContext()` throws, so every caller MUST guard
 * with `isCloudflareRuntime()` and keep a `process.env` fallback (see
 * `lib/db/client.ts`).
 */
export function cfEnv(): CloudflareEnv {
  return getCloudflareContext().env;
}

/**
 * True when running inside the Cloudflare Workers runtime. Detected via the
 * global `navigator.userAgent` workerd sets ("Cloudflare-Workers"); Node leaves
 * it undefined. Lets shared code branch to the Hyperdrive binding on CF while
 * keeping the `process.env` path for Node tests/scripts unchanged.
 */
export function isCloudflareRuntime(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.userAgent === 'Cloudflare-Workers'
  );
}
