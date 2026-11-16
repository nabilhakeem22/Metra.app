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
 *      Resend key, a Supabase secret key or a Postgres URL with a password,
 *      however it got there (./baked-secret-values.mjs; no file is skipped for
 *      its size).
 *
 * Runs immediately after `opennextjs-cloudflare build` in ci.yml and deploy.yml.
 * Never prints a VALUE — only the offending key name or the file's path.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesHoldingSecrets } from './baked-secret-values.mjs';

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

/**
 * The emitted env module, in a shape this script understands.
 *
 * The current OpenNext writes `export const production = {"KEY":"value",…}` per
 * mode; older versions wrote `process.env.KEY = …`. Recognising the SHAPE is what
 * lets zero keys mean two different things honestly: an empty `export const
 * production = {}` is a build with no .env file, which is the outcome we want,
 * while a file we cannot recognise at all means OpenNext changed and this script
 * is now measuring nothing.
 */
const KNOWN_SHAPES = [/export\s+const\s+\w+\s*=\s*\{/, /process\.env(?:\.\w+|\[)/];

function looksLikeEnvModule(source) {
  return KNOWN_SHAPES.some((shape) => shape.test(source));
}

const source = readEnvFile();
const keys = assignedKeys(source);

if (keys.length === 0 && !looksLikeEnvModule(source)) {
  bail(
    `no assigned keys found in ${envFile}, and it is not a module this script ` +
      'recognises.\nThe emitted shape changed — UPDATE THIS SCRIPT. Matching ' +
      'nothing is how a check like this dies: every build passes, including the ' +
      'one that bakes a secret.',
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

const withSecretValues = filesHoldingSecrets(bundleDir);
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
    'no secret-shaped values in the bundle).' +
    (keys.length === 0
      ? '\n  The env module is EMPTY, which is what a build with no .env file looks like.'
      : ''),
);
