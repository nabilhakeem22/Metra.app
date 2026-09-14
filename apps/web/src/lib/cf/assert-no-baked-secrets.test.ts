import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// The script guards a discipline that is invisible to tsc, to lint and to every
// other test: a re-added `process.env.SUPABASE_SERVICE_ROLE_KEY` compiles
// perfectly and only shows up in a build output nobody reads. So the script
// itself has to be trustworthy — including the case where it CANNOT find its
// input, which must fail rather than pass.

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, '../../../scripts/assert-no-baked-secrets.mjs');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway apps/web-shaped tree with `contents` as the emitted env module. */
function stage(contents: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'baked-secrets-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(script, join(root, 'scripts', 'assert-no-baked-secrets.mjs'));
  if (contents !== null) {
    mkdirSync(join(root, '.open-next', 'cloudflare'), { recursive: true });
    writeFileSync(join(root, '.open-next', 'cloudflare', 'next-env.mjs'), contents, 'utf8');
  }
  return join(root, 'scripts', 'assert-no-baked-secrets.mjs');
}

function run(contents: string | null): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [stage(contents)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (cause) {
    const error = cause as { status?: number; stdout?: string; stderr?: string };
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

const CI_SHAPED = `process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.NEXT_PUBLIC_APP_URL = "https://app.metra.test";
process.env.NODE_ENV = "production";
process.env.NEXT_RUNTIME = "edge";
`;

describe('assert-no-baked-secrets', () => {
  it('exits 0 on a build output that carries only public and framework keys', () => {
    const { code, output } = run(CI_SHAPED);
    expect(code).toBe(0);
    // And it actually SAW them. Without this the pass is indistinguishable from
    // a key pattern that matches nothing, which is how a check like this dies.
    expect(output).toContain('5 key(s)');
  });

  it('exits NON-ZERO when the service-role key was inlined', () => {
    const { code, output } = run(`${CI_SHAPED}process.env.SUPABASE_SERVICE_ROLE_KEY = "ey.J.secret";
`);
    expect(code).not.toBe(0);
    expect(output).toContain('SUPABASE_SERVICE_ROLE_KEY');
    // The key NAME is enough to act on; printing the VALUE would put the secret
    // into the CI log this check exists to keep it out of.
    expect(output).not.toContain('ey.J.secret');
  });

  it('catches the other secrets too, and lists all of them', () => {
    const { code, output } = run(
      `${CI_SHAPED}process.env.RESEND_API_KEY = "re_x";\nprocess.env.CRON_SECRET = "s";\n`,
    );
    expect(code).not.toBe(0);
    expect(output).toContain('RESEND_API_KEY');
    expect(output).toContain('CRON_SECRET');
  });

  it('also reads the object-literal shape older OpenNext versions emit', () => {
    const { code, output } = run(
      'export const env = { NEXT_PUBLIC_APP_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y" };\n',
    );
    expect(code).not.toBe(0);
    expect(output).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('reads the BRACKET form as well as the dotted one', () => {
    // `process.env["X"] = …` is the same assignment wearing different
    // punctuation, and it used to sail past the key pattern entirely.
    const { code, output } = run(
      'process.env["NEXT_PUBLIC_APP_URL"] = "x";\nprocess.env["RESEND_FROM"] = "y";\n',
    );
    expect(code).not.toBe(0);
    expect(output).toContain('RESEND_FROM');
  });

  it('FAILS when it matches NOTHING, instead of reporting a clean build', () => {
    // The failure mode that would have killed this check quietly: a shape it
    // cannot parse reads exactly like a build with no secrets in it.
    const { code, output } = run('export default freshShape(someOtherThing);\n');
    expect(code).not.toBe(0);
    expect(output).toContain('emitted shape changed');
  });

  it('catches a secret VALUE even under a public-looking key', () => {
    // The second pass. A service-role JWT is told apart from the anon JWT by its
    // own payload, so the legitimate anon key does not trip it.
    const serviceRole = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
      '{"iss":"supabase","role":"service_role","exp":2000000000}',
    ).toString('base64url')}.c2ln`;
    const { code, output } = run(
      `${CI_SHAPED}process.env.NEXT_PUBLIC_DECOY = "${serviceRole}";\n`,
    );
    expect(code).not.toBe(0);
    expect(output).toContain('service-role JWT');
    expect(output).toContain('next-env.mjs');
    // The PATH is what it prints. The value is what it exists to keep out of logs.
    expect(output).not.toContain(serviceRole);
  });

  it('leaves the anon JWT alone — it belongs in the bundle', () => {
    const anon = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(
      '{"iss":"supabase","role":"anon","exp":2000000000}',
    ).toString('base64url')}.c2ln`;
    const { code } = run(`${CI_SHAPED}process.env.NEXT_PUBLIC_ANON = "${anon}";\n`);
    expect(code).toBe(0);
  });

  it('catches a Resend key and a Postgres URL by shape', () => {
    const resend = run(`${CI_SHAPED}const k = "re_abcdefghij0123456789";\n`);
    expect(resend.code).not.toBe(0);
    expect(resend.output).toContain('Resend API key');
    expect(resend.output).not.toContain('re_abcdefghij0123456789');

    const dsn = run(`${CI_SHAPED}const u = "postgresql://metra:hunter2@db.host:5432/x";\n`);
    expect(dsn.code).not.toBe(0);
    expect(dsn.output).toContain('Postgres URL');
    expect(dsn.output).not.toContain('hunter2');
  });

  it('FAILS LOUDLY when the file is missing, rather than passing', () => {
    // If OpenNext moves or renames the file, a check that quietly passes would
    // let the guarantee lapse with nothing to notice it.
    const { code, output } = run(null);
    expect(code).not.toBe(0);
    expect(output).toContain('build layout changed');
  });
});
