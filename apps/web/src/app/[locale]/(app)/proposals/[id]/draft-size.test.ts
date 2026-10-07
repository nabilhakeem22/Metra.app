import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAFT_SAVE_MAX_BYTES, exceedsDraftSaveLimit, SERVER_ACTION_BODY_LIMIT_MB } from './draft-size';

describe('the draft save size guard (R2)', () => {
  it('matches the server action body limit set in next.config.mjs', () => {
    const config = readFileSync(resolve(__dirname, '../../../../../../next.config.mjs'), 'utf8');
    expect(config).toContain(`bodySizeLimit: '${SERVER_ACTION_BODY_LIMIT_MB}mb'`);
  });

  it('measures bytes, not characters (Arabic is two bytes a letter)', () => {
    const arabic = 'ب'.repeat(Math.floor(DRAFT_SAVE_MAX_BYTES / 2) + 1);
    expect(arabic.length).toBeLessThan(DRAFT_SAVE_MAX_BYTES);
    expect(exceedsDraftSaveLimit(arabic)).toBe(true);
  });

  it('a 2,000-line draft with 200-character descriptions in both languages fits', () => {
    const line = {
      id: '00000000-0000-4000-8000-000000000000',
      costItemId: null,
      descriptionEn: 'e'.repeat(200),
      descriptionAr: 'ع'.repeat(200),
      qty: '12.5',
      unit: 'sqm',
      unitCost: '310.5',
      unitPrice: '450',
      discountPct: '0',
      sortOrder: 0,
    };
    const payload = JSON.stringify({ sections: [{ titleEn: 'S', lines: Array.from({ length: 2000 }, () => line) }] });
    expect(exceedsDraftSaveLimit(payload)).toBe(false);
  });
});
