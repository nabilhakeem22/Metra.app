import { afterEach, describe, expect, it } from 'vitest';
import { CI_SHAPED, removeStagedBuilds, runBakedSecretsScript as run } from '@/test/baked-secrets-script';

// The script guards a discipline that is invisible to tsc, to lint and to every
// other test: a re-added `process.env.SUPABASE_SERVICE_ROLE_KEY` compiles
// perfectly and only shows up in a build output nobody reads. So the script
// itself has to be trustworthy — including the case where it CANNOT find its
// input, which must fail rather than pass.

afterEach(removeStagedBuilds);

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

  it('FAILS when it matches NOTHING in a module it does not recognise', () => {
    // The failure mode that would have killed this check quietly: a shape it
    // cannot parse reads exactly like a build with no secrets in it.
    const { code, output } = run('export default freshShape(someOtherThing);\n');
    expect(code).not.toBe(0);
    expect(output).toContain('emitted shape changed');
  });

  it('PASSES on an empty env module, which is what CI is supposed to produce', () => {
    // OpenNext emits one object per mode, compiled from the .env* FILES present.
    // No .env, no keys — the desired outcome, and it must not read as a broken
    // check. The shape is recognised; it is simply empty.
    const { code, output } = run(
      'export const production = {};\nexport const development = {};\n',
    );
    expect(code).toBe(0);
    expect(output).toContain('EMPTY');
  });

  it('reads the object-per-mode shape OpenNext actually emits', () => {
    const { code, output } = run(
      'export const production = {"NEXT_PUBLIC_APP_URL":"x","DATABASE_URL":"y"};\n',
    );
    expect(code).not.toBe(0);
    expect(output).toContain('DATABASE_URL');
  });

  it('does not fail a deploy over a library README', () => {
    // node_modules/postgres/README.md ships inside the bundle and documents
    // `postgres://username:password@host:port/database`. A shape-only scan cannot
    // tell that from a real DSN, so the value pass reads compiled files only.
    const { code } = run(CI_SHAPED, {
      'server-functions/default/node_modules/postgres/README.md':
        'const sql = postgres("postgres://username:password@host:port/database");',
    });
    expect(code).toBe(0);
  });

  it('still catches the same DSN in a compiled module', () => {
    const { code, output } = run(CI_SHAPED, {
      'server-functions/default/index.mjs':
        'const url = "postgresql://metra:hunter2@db.host:5432/x";',
    });
    expect(code).not.toBe(0);
    expect(output).toContain('index.mjs');
    expect(output).not.toContain('hunter2');
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
