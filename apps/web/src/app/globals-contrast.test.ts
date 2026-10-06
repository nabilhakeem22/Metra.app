import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, over, parseColour, themeTokens, type Rgba } from '@/test/contrast';

// The theme's ink/fill PAIRINGS, measured from globals.css itself. Each floor
// is WCAG's: 4.5:1 for text (the band labels and chips are 12-13px, far from
// the large-text exemption), 3:1 for a non-text shape the eye must tell apart.
// Every pairing is measured on the WORSE of the two surfaces a card can be:
// the opaque bridge `--card`, or the translucent `--glass` laid over the page.

const css = readFileSync(fileURLToPath(new URL('./globals.css', import.meta.url)), 'utf8');
const THEMES = {
  light: themeTokens(css, /\[data-theme='light'\]/),
  dark: themeTokens(css, /\[data-theme='dark'\]/),
};

type Theme = keyof typeof THEMES;

function colour(theme: Theme, name: string): Rgba {
  const value = THEMES[theme].get(name);
  if (!value) throw new Error(`${theme}: no ${name}`);
  return parseColour(value);
}

/** The two surfaces a card can be, opaque. */
function surfaces(theme: Theme): Rgba[] {
  const page = colour(theme, '--bg-base');
  return [colour(theme, '--card'), over(colour(theme, '--glass'), page)];
}

/** The worst ratio of `ink` over `fill` (laid on each surface). */
function worst(theme: Theme, ink: string, fill: string | null): number {
  return Math.min(
    ...surfaces(theme).map((surface) => {
      const ground = fill ? over(colour(theme, fill), surface) : surface;
      return contrastRatio(colour(theme, ink), ground);
    }),
  );
}

describe.each(['light', 'dark'] as const)('%s theme', (theme) => {
  // The status band, the tab track, chips: --track laid over the card.
  it.each(['--text', '--text-body', '--text-muted', '--text-faint', '--brand-ink', '--warn'])(
    'text %s on the tinted band is >= 4.5:1',
    (ink) => {
      expect(worst(theme, ink, '--track')).toBeGreaterThanOrEqual(4.5);
    },
  );

  // StatusChip: each tone's ink on its own fill (draft has no fill).
  it.each([
    ['yourMove', '--brand-ink', '--brand-tint'],
    ['waiting', '--text-muted', '--track'],
    ['stalled', '--warn', '--warn-tint'],
    ['done', '--success', '--success-tint'],
    ['draft', '--text-muted', null],
    ['neutral', '--text-muted', '--track'],
  ] as const)('StatusChip %s ink on its fill is >= 4.5:1', (_tone, ink, fill) => {
    expect(worst(theme, ink, fill)).toBeGreaterThanOrEqual(4.5);
  });

  // The spine: where you ARE must be told from what you have DONE by fill alone.
  it('the spine current segment vs a done one is >= 3:1', () => {
    const ratios = surfaces(theme).map((surface) => {
      const current = over(parseColour(THEMES[theme].get('--brand')!), surface);
      return contrastRatio(current, over(colour(theme, '--spine-done'), surface));
    });
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(3);
  });

  it('--danger on the card is >= 4.5:1', () => {
    expect(worst(theme, '--danger', null)).toBeGreaterThanOrEqual(4.5);
  });
});
