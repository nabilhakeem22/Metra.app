import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// TEST-ONLY. The Rate Limiting bindings exactly as apps/web/wrangler.jsonc
// declares them. Tests read every ceiling from here, so a ceiling is changed by
// one line in wrangler.jsonc and nowhere else.

export const WEB_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

export interface RateLimitEntry {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: number };
}

/** apps/web/wrangler.jsonc, parsed as JSONC (comments allowed). */
export function wranglerConfig(): Record<string, unknown> {
  const path = resolve(WEB_ROOT, 'wrangler.jsonc');
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (parsed.error) throw new Error(`wrangler.jsonc does not parse: ${String(parsed.error.messageText)}`);
  return parsed.config as Record<string, unknown>;
}

/** The `ratelimits` array of wrangler.jsonc. */
export function configuredRateLimits(): RateLimitEntry[] {
  return (wranglerConfig() as { ratelimits: RateLimitEntry[] }).ratelimits;
}

/** The configured ceiling of one binding; throws when the binding is not declared. */
export function rateLimitCeiling(name: string): number {
  const entry = configuredRateLimits().find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`${name} is not declared in wrangler.jsonc`);
  return entry.simple.limit;
}

/** The two portal budgets' ceilings. */
export const PORTAL_ACT_CEILING = rateLimitCeiling('PORTAL_ACT_RATE_LIMITER');
export const PORTAL_READ_CEILING = rateLimitCeiling('PORTAL_READ_RATE_LIMITER');
export const STUDIO_READ_CEILING = rateLimitCeiling('STUDIO_READ_RATE_LIMITER');
export const STUDIO_SEARCH_CEILING = rateLimitCeiling('STUDIO_SEARCH_RATE_LIMITER');
