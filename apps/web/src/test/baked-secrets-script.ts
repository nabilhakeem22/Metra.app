import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// TEST-ONLY. Runs scripts/assert-no-baked-secrets.mjs, the real script with
// the value pass it imports, against a throwaway build output, so its tests
// (lib/cf/assert-no-baked-secrets*.test.ts) share one way of staging a tree.

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts');
const SCRIPT = 'assert-no-baked-secrets.mjs';
/** Everything the script is made of: itself, and the value pass beside it. */
const SCRIPT_FILES = [SCRIPT, 'baked-secret-values.mjs'];

const roots: string[] = [];

/** Deletes every tree staged so far. Call it after each test. */
export function removeStagedBuilds(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** A throwaway apps/web-shaped tree with `contents` as the emitted env module,
 *  plus any extra bundle files the case needs (path relative to .open-next). */
function stage(contents: string | null, extras: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'baked-secrets-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const file of SCRIPT_FILES) copyFileSync(join(SCRIPTS, file), join(root, 'scripts', file));
  if (contents !== null) {
    mkdirSync(join(root, '.open-next', 'cloudflare'), { recursive: true });
    writeFileSync(join(root, '.open-next', 'cloudflare', 'next-env.mjs'), contents, 'utf8');
  }
  for (const [relativePath, body] of Object.entries(extras)) {
    const full = join(root, '.open-next', relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  return join(root, 'scripts', SCRIPT);
}

/** The script's exit code and everything it printed, for a staged build output. */
export function runBakedSecretsScript(
  contents: string | null,
  extras: Record<string, string> = {},
): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [stage(contents, extras)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (cause) {
    const error = cause as { status?: number; stdout?: string; stderr?: string };
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

/** The env module a clean CI build emits: public and framework keys only. */
export const CI_SHAPED = `process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.NEXT_PUBLIC_APP_URL = "https://app.metra.test";
process.env.NODE_ENV = "production";
process.env.NEXT_RUNTIME = "edge";
`;
