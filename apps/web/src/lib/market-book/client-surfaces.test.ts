import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// AC 16: market prices and their attribution are a STUDIO reference, never put
// in front of a client. Nothing the client reads (the /c, /d, /p and /v link
// pages, every PDF, the public token readers, the public API) imports the
// market book or reads a marketBook.* message.

const SRC = fileURLToPath(new URL('../..', import.meta.url));

const CLIENT_SURFACES = [
  'app/[locale]/c',
  'app/[locale]/d',
  'app/[locale]/p',
  'app/[locale]/v',
  'app/api/pdf',
  'app/api/v1',
  'lib/pdf',
  'lib/api',
  'lib/contracts/public.ts',
  'lib/proposals/public.ts',
  'lib/variations/public.ts',
  'lib/engagements/public',
  'lib/engagements/public-comments.ts',
  'lib/engagements/public-documents.ts',
  'lib/engagements/public-logo.ts',
];

/** The market-book wording the API's error catalogue may name: its two refusal codes, never a price. */
const ACTION_CODE_CATALOGUE = ['lib/api/action-code-problem.ts', 'lib/api/errors.test.ts'];

function sourceFiles(path: string): string[] {
  const absolute = join(SRC, path);
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute).flatMap((name) => sourceFiles(join(path, name))).filter((file) => /\.(ts|tsx)$/.test(file));
}

describe('market prices stay off client surfaces (AC 16)', () => {
  const files = CLIENT_SURFACES.flatMap(sourceFiles);

  it('finds the surfaces to read', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((file) => [relative(SRC, file).replace(/\\/g, '/'), file]))('%s reads no market book', (path, file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/lib\/market-book|market_price_observations|market_seed_book|market_items/);
    if (!ACTION_CODE_CATALOGUE.includes(path)) expect(text).not.toMatch(/marketBook|market_item_/);
  });
});
