import { afterEach, describe, expect, it } from 'vitest';
import { CI_SHAPED, removeStagedBuilds, runBakedSecretsScript as run } from '@/test/baked-secrets-script';
import { SCAN_CHUNK_BYTES, SCAN_OVERLAP_BYTES } from '../../../scripts/baked-secret-values.mjs';

// C8: two blind spots of the value pass. A file over 8 MiB used to be skipped,
// and the server handler bundle is the likeliest home of an inlined literal;
// every file is now read in chunks whose tails overlap, so size hides nothing
// and neither does a chunk boundary. And the new-format Supabase secret key
// (sb_secret_...) has a shape of its own.

/** The size above which the script used to skip a file. */
const OLD_SKIP_LIMIT_BYTES = 8 * 1024 * 1024;
const HANDLER = 'server-functions/default/handler.mjs';

const RESEND_KEY = 're_abcdefghij0123456789';
const SUPABASE_SECRET_KEY = 'sb_secret_AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const SERVICE_ROLE_JWT = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
  '{"iss":"supabase","role":"service_role","exp":2000000000}',
).toString('base64url')}.c2ln`;

/**
 * A module over the old skip limit that holds `secret` as a string literal,
 * placed so that `bytesBeforeBoundary` bytes of the statement fall before the
 * chunk boundary at `boundary` and the rest after it.
 */
function largeModuleWith(secret: string, boundary: number, bytesBeforeBoundary: number): string {
  const statement = `;const leaked = "${secret}";`;
  const before = ' '.repeat(boundary - bytesBeforeBoundary);
  const after = ' '.repeat(Math.max(0, OLD_SKIP_LIMIT_BYTES + 1024 - before.length - statement.length));
  return `${before}${statement}${after}`;
}

afterEach(removeStagedBuilds);

describe('assert-no-baked-secrets: a file over the old 8 MiB limit is scanned (C8)', () => {
  it('reads in chunks smaller than the old limit, with an overlap longer than any secret', () => {
    expect(2 * SCAN_CHUNK_BYTES).toBeLessThanOrEqual(OLD_SKIP_LIMIT_BYTES);
    expect(SCAN_OVERLAP_BYTES).toBeGreaterThan(10 * SERVICE_ROLE_JWT.length);
  });

  it.each([
    ['a Resend key split across the first chunk boundary', RESEND_KEY, SCAN_CHUNK_BYTES, 'Resend API key'],
    ['a service-role JWT split across the second chunk boundary', SERVICE_ROLE_JWT, 2 * SCAN_CHUNK_BYTES, 'service-role JWT'],
    ['a Supabase secret key split across the second chunk boundary', SUPABASE_SECRET_KEY, 2 * SCAN_CHUNK_BYTES, 'Supabase secret key'],
  ])('catches %s, and prints the path, never the value', (_case, secret, boundary, kind) => {
    const module = largeModuleWith(secret, boundary, 20);
    expect(module.length).toBeGreaterThan(OLD_SKIP_LIMIT_BYTES);
    const { code, output } = run(CI_SHAPED, { [HANDLER]: module });
    expect(code).not.toBe(0);
    expect(output).toContain('handler.mjs');
    expect(output).toContain(kind);
    expect(output).not.toContain(secret);
  });

  it('catches a secret at the very end of a file over the old limit', () => {
    const module = `${' '.repeat(OLD_SKIP_LIMIT_BYTES + 4096)};const leaked = "${RESEND_KEY}";`;
    const { code, output } = run(CI_SHAPED, { [HANDLER]: module });
    expect(code).not.toBe(0);
    expect(output).toContain('Resend API key');
  });

  it('passes a file over the old limit that holds no secret', () => {
    const { code, output } = run(CI_SHAPED, { [HANDLER]: largeModuleWith('nothing-secret-here', SCAN_CHUNK_BYTES, 20) });
    expect(code).toBe(0);
    expect(output).toContain('5 key(s)');
  });
});

describe('assert-no-baked-secrets: the new-format Supabase keys (C8)', () => {
  it('catches an sb_secret_ value by shape, under any name, and never prints it', () => {
    const { code, output } = run(`${CI_SHAPED}process.env.NEXT_PUBLIC_DECOY = "${SUPABASE_SECRET_KEY}";\n`);
    expect(code).not.toBe(0);
    expect(output).toContain('Supabase secret key');
    expect(output).toContain('next-env.mjs');
    expect(output).not.toContain(SUPABASE_SECRET_KEY);
  });

  it('leaves the publishable key alone: it belongs in the bundle', () => {
    const publishable = 'sb_publishable_AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const { code } = run(`${CI_SHAPED}process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "${publishable}";\n`);
    expect(code).toBe(0);
  });

  it('leaves the bare prefix alone: a library that only names the format holds no key', () => {
    const { code } = run(CI_SHAPED, { 'server-functions/default/index.mjs': 'const isSecret = key.startsWith("sb_secret_");' });
    expect(code).toBe(0);
  });
});
