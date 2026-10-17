import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AC 23: the gate makes no network call other than to Postgres and reads no API
// key. Extraction happens in a Claude Code session, never in repo code.
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = [/ANTHROPIC/, /GEMINI/, /OPENAI/, /\bfetch\(/, /node:https?['"]/, /from ['"]https?['"]/, /XMLHttpRequest/];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|py)$/.test(name) && path !== fileURLToPath(import.meta.url) ? [path] : [];
  });
}

describe('packages/market-ingest makes no network call (AC 23)', () => {
  it('finds the sources it is meant to scan', () => {
    expect(sourceFiles(packageRoot).length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN.map((pattern) => [pattern.source, pattern]))('no source matches %s', (_name, pattern) => {
    const offenders = sourceFiles(packageRoot).filter((path) => pattern.test(readFileSync(path, 'utf8')));
    expect(offenders.map((path) => relative(packageRoot, path))).toEqual([]);
  });
});
