import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RULE_IDS } from './format';

// The extraction brief copies the format types verbatim. A drift would hand
// every future session a format the checker refuses, so the copy is compared.
const here = dirname(fileURLToPath(import.meta.url));
const brief = readFileSync(join(here, '../../../docs/market-price-book/EXTRACTION.md'), 'utf8').replace(/\r\n/g, '\n');
const format = readFileSync(join(here, 'format.ts'), 'utf8').replace(/\r\n/g, '\n');

describe('docs/market-price-book/EXTRACTION.md', () => {
  it('carries src/format.ts verbatim, from the format id to the end', () => {
    const body = format.slice(format.indexOf('export const MARKET_BULLETIN_FORMAT')).trimEnd();
    expect(brief).toContain(`\`\`\`ts\n${body}\n\`\`\``);
  });

  it('defines every rule the checker accepts', () => {
    for (const rule of RULE_IDS) expect(brief).toContain(`**${rule} `);
  });
});
