#!/usr/bin/env node
/**
 * Fail the build if a SECRET was inlined into the Cloudflare Worker bundle.
 *
 * OpenNext compiles the project's `.env*` FILES into
 * `.open-next/cloudflare/next-env.mjs` at build time, and that module ships
 * inside the deployed artifact. For a NEXT_PUBLIC_ var that is exactly the
 * intent. For SUPABASE_SERVICE_ROLE_KEY — a full RLS bypass — it would mean the
 * secret sits in a build output, in any CI log that prints it, and in every
 * deploy, and can only be rotated by rebuilding.
 *
 * The rule the rest of the codebase follows is therefore "no .env* file in a
 * CI/deploy build, and read secrets at request time" (lib/cf/secrets.ts). THIS
 * script is what keeps it true: the discipline is invisible to tsc, to lint and
 * to every unit test, because a re-added secret compiles perfectly and only
 * shows up in a build output nobody reads.
 *
 * TWO PASSES, because a key name is not the only way a secret gets in:
 *   1. the KEYS assigned in the emitted env module — the shape OpenNext writes;
 *   2. the VALUES, over the whole `.open-next` tree — a service-role JWT, a
 *      Resend key or a Postgres URL with a password, however it got there.
 *
 * Runs immediately after `opennextjs-cloudflare build` in ci.yml and deploy.yml.
 * Never prints a VALUE — only the offending key name or the file's path.
 */
import { Buffer } from 'node:buffer';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const bundleDir = resolve(here, '../.open-next');
const envFile = resolve(bundleDir, 'cloudflare/next-env.mjs');

/**
 * Keys that are legitimately in the bundle and are not secrets. NODE_ENV and
 * NEXT_RUNTIME are set by the framework itself, not by us. Everything else must
 * be NEXT_PUBLIC_, which is the declaration that a value is meant for a browser.
 */
const ALLOWLIST = new Set(['NODE_ENV', 'NEXT_RUNTIME']);

/** Loud on purpose: a check that cannot find its input must fail, not pass. */
function bail(message, cause) {
  console.error(`assert-no-baked-secrets: ${message}`);
  if (cause !== undefined) console.error(String(cause));
  process.exit(1);
}

function readEnvFile() {
  try {
    return readFileSync(envFile, 'utf8');
  } catch (cause) {
    bail(
      `cannot read ${envFile}\n` +
        'The OpenNext build layout changed — UPDATE THIS SCRIPT. Do not delete it: ' +
        'a check that cannot find its input must fail, not pass.',
      cause,
    );
  }
}

/** Every key assigned in the emitted env module, in source order. */
function assignedKeys(source) {
  const keys = [];
  // Matches `FOO:`, `"FOO":`, `FOO =`, `process.env.FOO =` and
  // `process.env["FOO"] =` alike — the emitted shape has changed across OpenNext
  // versions, so match broadly and let the allowlist do the deciding. The `.` and
  // `[` in the prefix class are what catch the two `process.env` forms; without
  // them this check matches NOTHING and passes every build.
  const pattern = /(?:^|[\s{,;.[])["']?([A-Z][A-Z0-9_]*)["']?\]?\s*[:=]/gm;
  for (const match of source.matchAll(pattern)) keys.push(match[1]);
  return [...new Set(keys)];
}

/** Value shapes that cannot belong to a public var, whatever they are named. */
const VALUE_PATTERNS = [
  { what: 'a Resend API key', pattern: /\bre_[A-Za-z0-9]{16,}/ },
  {
    what: 'a Postgres URL carrying a password',
    pattern: /postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@/,
  },
];

/**
 * Does this text hold a SERVICE-ROLE JWT?
 *
 * The anon key is a JWT too and belongs in the bundle, so `eyJ…` on its own
 * proves nothing. The two are told apart by the JWT's own payload: decode the
 * middle segment and look for the role claim. Nothing decoded is ever printed.
 */
function hasServiceRoleJwt(text) {
  const jwt = /eyJ[A-Za-z0-9_-]{20,}\.(eyJ[A-Za-z0-9_-]{20,})\.[A-Za-z0-9_-]+/g;
  for (const [, payload] of text.matchAll(jwt)) {
    try {
      if (Buffer.from(payload, 'base64url').toString('utf8').includes('service_role')) {
        return true;
      }
    } catch {
      // An `eyJ…` run that is not base64url is not a JWT. Not our business.
    }
  }
  return false;
}

/** Every file under `dir`, depth first. */
function* filesUnder(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* filesUnder(path);
    else if (entry.isFile()) yield path;
  }
}

/** Paths under `.open-next` whose CONTENT looks like a secret. */
function filesHoldingSecrets() {
  const hits = [];
  for (const path of filesUnder(bundleDir)) {
    // A wasm blob or a source map is megabytes of noise; a baked secret lives in
    // a module, so skip the outliers by size rather than read them all.
    if (statSync(path).size > 8 * 1024 * 1024) continue;
    const text = readFileSync(path, 'latin1');
    const hit =
      VALUE_PATTERNS.find(({ pattern }) => pattern.test(text))?.what ??
      (hasServiceRoleJwt(text) ? 'a service-role JWT' : null);
    if (hit) hits.push(`  - ${relative(bundleDir, path)} (${hit})`);
  }
  return hits;
}

const source = readEnvFile();
const keys = assignedKeys(source);

if (keys.length === 0) {
  bail(
    `no assigned keys found in ${envFile}\n` +
      'The emitted shape changed — UPDATE THIS SCRIPT. Matching nothing is how a ' +
      'check like this dies: every build passes, including the one baking a secret.',
  );
}

const baked = keys.filter(
  (key) => !key.startsWith('NEXT_PUBLIC_') && !ALLOWLIST.has(key),
);
if (baked.length > 0) {
  bail(
    'non-public value(s) inlined into the Worker bundle:\n' +
      baked.map((key) => `  - ${key}`).join('\n') +
      '\n\nRead it at request time with runtimeSecret() from lib/cf/secrets.ts, or ' +
      'rename it NEXT_PUBLIC_ if it is genuinely meant for the browser.',
  );
}

const withSecretValues = filesHoldingSecrets();
if (withSecretValues.length > 0) {
  bail(
    'secret-shaped VALUE(s) in the build output:\n' +
      withSecretValues.join('\n') +
      '\n\nOnly the path is printed. Rotate the credential, then keep it out of the ' +
      'build: no .env* file in a CI/deploy build, and read it with runtimeSecret().',
  );
}

console.log(
  `assert-no-baked-secrets: OK (${keys.length} key(s), all public or framework; ` +
    'no secret-shaped values in the bundle).',
);
