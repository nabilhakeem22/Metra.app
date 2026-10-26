import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AC13, OD2 strict (H5): no "I paid" without a one-time code. The two claim
// functions the code-checked acts wrap are reachable from the app through
// those acts only, so their names appear NOWHERE in the app's source (code or
// comment); the database tests of their own rules call them from
// apps/web/tests/actions. DB step C2 later makes the functions themselves
// refuse a call without the code's flag.

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib/client-home
const SOURCE_ROOT = resolve(here, '../..'); // apps/web/src
const UNVERIFIED_CLAIMS = ['app_delivery_claim_request_by_token', 'app_delivery_claim_payment_by_token'];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|json)$/.test(name) ? [path] : [];
  });
}

describe('no app code reaches a claim without a code (AC13)', () => {
  it('names neither unverified claim function anywhere under apps/web/src', () => {
    const files = sourceFiles(SOURCE_ROOT).filter((path) => path !== fileURLToPath(import.meta.url));
    expect(files.length).toBeGreaterThan(500);
    const mentions = files.flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return UNVERIFIED_CLAIMS.filter((name) => text.includes(name)).map((name) => `${relative(SOURCE_ROOT, path)}: ${name}`);
    });
    expect(mentions).toEqual([]);
  });

  it('the code-checked wrappers are what the app calls', () => {
    const acts = readFileSync(join(here, 'code-acts.ts'), 'utf8');
    expect(acts).toContain('select public.app_home_claim_request_by_token(');
    expect(acts).toContain('select public.app_home_claim_design_payment_by_token(');
  });
});
