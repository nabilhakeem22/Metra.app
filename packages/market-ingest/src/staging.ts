// Where a bulletin's files live: `<staging>/<YYYY-MM>/...`, with <staging> =
// MARKET_STAGING_DIR or `<repo>/.market-staging/` (gitignored). File IO only.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function stagingRoot(): string {
  const configured = process.env.MARKET_STAGING_DIR;
  return configured && configured.trim() !== '' ? resolve(configured) : join(repoRoot, '.market-staging');
}

export interface PeriodPaths {
  dir: string;
  bulletin: string;
  partsDir: string;
  mapping: string;
  corrections: string;
  check: string;
  staged: string;
  review: string;
}

export function periodPaths(period: string): PeriodPaths {
  const dir = join(stagingRoot(), period);
  return {
    dir,
    bulletin: join(dir, 'bulletin.json'),
    partsDir: join(dir, 'parts'),
    mapping: join(dir, 'mapping.json'),
    corrections: join(dir, 'corrections.json'),
    check: join(dir, 'check.json'),
    staged: join(dir, 'staged.json'),
    review: join(dir, 'review.html'),
  };
}

export function cataloguePath(): string {
  return join(stagingRoot(), 'catalogue.json');
}

/** Parsed JSON, or a specific error naming the file. */
function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}

/** The parsed file, or `fallback` when it does not exist. */
export function readOptionalJson(path: string, fallback: unknown): unknown {
  return existsSync(path) ? readJson(path) : fallback;
}

/** Canonical bytes: two-space JSON plus a final newline, so a hash is reproducible. */
export function jsonBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

export function sha256Hex(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256OfFile(path: string): string {
  return sha256Hex(readFileSync(path));
}

/** The producer's input: every `parts/*.json` when there are parts, else `bulletin.json`. */
export function readProducerFiles(paths: PeriodPaths): Array<{ name: string; value: unknown }> {
  const parts = existsSync(paths.partsDir)
    ? readdirSync(paths.partsDir).filter((name) => name.endsWith('.json')).sort()
    : [];
  if (parts.length > 0) {
    if (existsSync(paths.bulletin)) {
      throw new Error(`${paths.dir} holds both bulletin.json and parts/*.json; keep one of them`);
    }
    return parts.map((name) => ({ name: `parts/${name}`, value: readJson(join(paths.partsDir, name)) }));
  }
  if (!existsSync(paths.bulletin)) {
    throw new Error(`no bulletin.json and no parts/*.json in ${paths.dir}`);
  }
  return [{ name: 'bulletin.json', value: readJson(paths.bulletin) }];
}
