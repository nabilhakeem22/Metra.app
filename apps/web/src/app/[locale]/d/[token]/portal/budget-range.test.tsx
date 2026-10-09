import { describe, expect, it } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BudgetRange } from './budget-range';

// The issued budget band, as the client reads it: the currency label once, in the
// locale's reading order, Latin digits in left-to-right isolates.

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const ROM = { low: '900000.0000', high: '1200000.0000' };

/** The budget range's parts (figures, words, currency) in DOM order. */
function rangeParts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-part]')].map((part) => part.textContent ?? '');
}

function renderRange(rom: { low: string | null; high: string | null }, locale: TestLocale) {
  return renderWithIntl(<BudgetRange rom={rom} />, { locale });
}

describe('BudgetRange', () => {
  it('orders the Arabic range for a right-to-left reader: low, to, high, then the currency', () => {
    const { container } = renderRange(ROM, 'ar-EG');
    // The row follows the document direction (no forced ltr), so DOM order IS the
    // right-to-left reading order, ending with ج.م at the far left.
    const row = container.querySelector('[data-part]')?.parentElement as HTMLElement;
    expect(row.hasAttribute('dir')).toBe(false);
    expect(rangeParts(container)).toEqual([
      '900,000',
      messageAt('ar-EG', 'delivery.budget.to'),
      '1,200,000',
      'ج.م',
    ]);
    // Each figure is its own left-to-right isolate, Latin digits.
    const figures = container.querySelectorAll('bdi[data-part="figure"]');
    expect([...figures].map((figure) => figure.getAttribute('dir'))).toEqual(['ltr', 'ltr']);
    expect(ARABIC_INDIC.test(container.textContent ?? '')).toBe(false);
  });

  it('shows a lone low bound as a "from" figure and a lone high bound as "up to"', () => {
    const low = renderRange({ low: '900000.0000', high: null }, 'en');
    expect(rangeParts(low.container)).toEqual([
      messageAt('en', 'delivery.budget.from'),
      'EGP',
      '900,000',
    ]);
    low.unmount();

    const high = renderRange({ low: null, high: '1200000.0000' }, 'ar-EG');
    expect(rangeParts(high.container)).toEqual([
      messageAt('ar-EG', 'delivery.budget.upTo'),
      '1,200,000',
      'ج.م',
    ]);
  });

  it('keeps 2 decimals on a bound that is not whole', () => {
    const { container } = renderRange({ low: '900000.5000', high: '1200000.0000' }, 'en');
    expect(rangeParts(container)).toEqual([
      'EGP',
      '900,000.50',
      messageAt('en', 'delivery.budget.to'),
      '1,200,000',
    ]);
  });
});
