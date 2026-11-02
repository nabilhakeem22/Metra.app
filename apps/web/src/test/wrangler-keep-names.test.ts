import { describe, expect, it } from 'vitest';
import { wranglerConfig } from './wrangler-rate-limits';

// Wrangler bundles the Worker with esbuild's keep-names ON by default, which
// wraps every function in a `__name(fn, "fn")` call. next-themes ships its
// no-flash theme script to the browser as the function's own source text, so
// the wrapper went with it, and every page the Worker rendered threw
// `__name is not defined` before the stored theme was applied. OpenNext's
// documented fix is `keep_names: false` (opennext.js.org/cloudflare/howtos/keep_names).
describe('wrangler.jsonc', () => {
  it('turns esbuild keep-names off, so no inline script ships a __name call', () => {
    expect(wranglerConfig().keep_names).toBe(false);
  });
});
