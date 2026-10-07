import { describe, expect, it } from 'vitest';
import { emailDeliveryLabel } from './email-label';

// The studio email names the delivery `DE-YYYY-NNNN · title` from what the
// notifier returned (0057), with no second read through the client's token.

const villa = { number: 12, year: 2026, titleAr: 'فيلا التجمع', titleEn: 'Tagamoa villa' };

describe('emailDeliveryLabel', () => {
  it('reads DE-YYYY-NNNN · title in the studio language', () => {
    expect(emailDeliveryLabel(villa, 'en')).toBe('DE-2026-0012 · Tagamoa villa');
    expect(emailDeliveryLabel(villa, 'ar-EG')).toBe('DE-2026-0012 · فيلا التجمع');
  });

  it('falls back to the other title, and to the number alone', () => {
    expect(emailDeliveryLabel({ ...villa, titleEn: null }, 'en')).toBe('DE-2026-0012 · فيلا التجمع');
    expect(emailDeliveryLabel({ ...villa, titleAr: '  ', titleEn: null }, 'ar-EG')).toBe('DE-2026-0012');
  });

  it('flattens the title to one capped line', () => {
    const label = emailDeliveryLabel({ ...villa, titleEn: `Line one\nline two ${'x'.repeat(300)}` }, 'en');
    expect(label.startsWith('DE-2026-0012 · Line one line two')).toBe(true);
    expect(label).not.toContain('\n');
    expect(label.endsWith('…')).toBe(true);
  });

  it('is empty when the notifier returned no usable delivery', () => {
    expect(emailDeliveryLabel(null, 'en')).toBe('');
  });
});
