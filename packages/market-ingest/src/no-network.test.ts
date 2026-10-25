import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AC 23: the gate makes no network call other than to Postgres and reads no API
// key. An ALLOWLIST of what the package may import, not a list of what it may
// not: a denylist missed node:net, node:tls, undici, a dynamic import and a
// spawned curl (S5). Every import, export-from, require and dynamic import is
// read; anything not on the list fails, so a new dependency is a decision.
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const thisFile = fileURLToPath(import.meta.url);

const ALLOWED_TS = new Set([
  'node:fs', 'node:path', 'node:url', 'node:crypto', 'node:util', 'node:os', 'node:child_process',
  'postgres', '@metra/db', '@metra/db/client', '@metra/db/schema', '@metra/db/lock-timeout', '@metra/db/sqlstate',
  '@metra/db/market-seed', '@metra/db/market-seed/db', '@metra/db/market-percent',
  'vitest', 'vitest/config', 'dotenv',
]);
const ALLOWED_PY = new Set(['argparse', 'pathlib', 'sys', 'pymupdf']);

function files(directory: string, extension: RegExp): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return files(path, extension);
    return extension.test(name) && path !== thisFile ? [path] : [];
  });
}

const SPECIFIER = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function tsImports(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4]);
}

function pyImports(source: string): string[] {
  return [...source.matchAll(/^\s*(?:import|from)\s+([A-Za-z_][\w.]*)/gm)].map((match) => match[1].split('.')[0]);
}

describe('packages/market-ingest makes no network call (AC 23)', () => {
  const tsFiles = files(packageRoot, /\.ts$/);

  it('finds the sources it is meant to scan', () => {
    expect(tsFiles.length).toBeGreaterThan(30);
    expect(files(packageRoot, /\.py$/)).toHaveLength(1);
  });

  it('imports only from the allowlist (relative imports are the package itself)', () => {
    const outside = tsFiles.flatMap((path) =>
      tsImports(readFileSync(path, 'utf8'))
        .filter((specifier) => !specifier.startsWith('.') && !ALLOWED_TS.has(specifier))
        .map((specifier) => `${relative(packageRoot, path)}: ${specifier}`),
    );
    expect(outside).toEqual([]);
  });

  it('reads every kind of import (a guard on the guard)', () => {
    const sample = "import a from 'x1';\nexport { b } from 'x2';\nimport 'x3';\nawait import('x4');\nrequire('x5');";
    expect(tsImports(sample)).toEqual(['x1', 'x2', 'x3', 'x4', 'x5']);
  });

  // The one other process a TEST may start: this package's own CLI on the
  // same Node binary (seed-connection-lost.dbtest.ts runs it as the owner
  // does, to see what a lost connection does to the whole process). Never in
  // the package's sources.
  const OWN_CLI = /\bspawn\(process\.execPath, \['--import=tsx', 'src\/cli\.ts'/g;
  const isTest = (path: string) => relative(packageRoot, path).split(/[\\/]/)[0] === 'tests';

  it('spawns git and nothing else (and, from a test, its own CLI)', () => {
    for (const path of tsFiles) {
      const source = readFileSync(path, 'utf8');
      if (!source.includes('node:child_process')) continue;
      const spawns = source.match(/\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\(/g) ?? [];
      const gitCalls = source.match(/\bexecFileSync\('git'/g) ?? [];
      const ownCli = isTest(path) ? (source.match(OWN_CLI) ?? []) : [];
      expect({ file: relative(packageRoot, path), spawns: spawns.length }).toEqual({ file: relative(packageRoot, path), spawns: gitCalls.length + ownCli.length });
    }
  });

  it('the render script imports only argparse, pathlib, sys and pymupdf', () => {
    for (const path of files(packageRoot, /\.py$/)) {
      expect(pyImports(readFileSync(path, 'utf8')).filter((name) => !ALLOWED_PY.has(name))).toEqual([]);
    }
  });

  it.each([/ANTHROPIC/, /GEMINI/, /OPENAI/])('names no API key (%s)', (pattern) => {
    expect(tsFiles.filter((path) => pattern.test(readFileSync(path, 'utf8'))).map((path) => relative(packageRoot, path))).toEqual([]);
  });
});
