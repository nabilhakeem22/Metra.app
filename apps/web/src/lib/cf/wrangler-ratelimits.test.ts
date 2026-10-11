import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Round D (W7): the Rate Limiting bindings in apps/web/wrangler.jsonc are the
// ones the code asks for, at the ceilings the code's comments promise. A binding
// the code names but the config lacks is a refused surface on Cloudflare (a
// missing binding throws), so this catches it before a deploy does.

const webRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

interface RateLimitEntry {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: number };
}

/** The `ratelimits` array of wrangler.jsonc, parsed as JSONC (comments allowed). */
function configuredRateLimits(): RateLimitEntry[] {
  const path = resolve(webRoot, 'wrangler.jsonc');
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (parsed.error) throw new Error(`wrangler.jsonc does not parse: ${String(parsed.error.messageText)}`);
  return (parsed.config as { ratelimits: RateLimitEntry[] }).ratelimits;
}

/** Every `*_RATE_LIMITER` binding name the limiter modules ask for. */
function bindingNamesInCode(): string[] {
  const files = ['src/lib/api/rate-limit.ts', 'src/lib/share/portal-rate-limit.ts'];
  const names = files.flatMap((file) =>
    [...readFileSync(resolve(webRoot, file), 'utf8').matchAll(/'([A-Z_]+_RATE_LIMITER)'/g)].map((match) => match[1]),
  );
  return [...new Set(names)].sort();
}

describe('wrangler.jsonc ratelimits', () => {
  const entries = configuredRateLimits();

  it('declares the four bindings at their ceilings, each over 60 seconds', () => {
    expect(entries.map(({ name, simple }) => [name, simple.limit, simple.period])).toEqual([
      ['API_RATE_LIMITER', 100, 60],
      ['API_PREAUTH_RATE_LIMITER', 300, 60],
      ['PORTAL_ACT_RATE_LIMITER', 30, 60],
      ['PORTAL_READ_RATE_LIMITER', 300, 60],
    ]);
  });

  it('gives every binding its own integer namespace id', () => {
    const ids = entries.map((entry) => entry.namespace_id);
    for (const id of ids) expect(id).toMatch(/^[1-9][0-9]*$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares exactly the bindings the code asks for', () => {
    expect(bindingNamesInCode()).toEqual(entries.map((entry) => entry.name).sort());
  });
});
