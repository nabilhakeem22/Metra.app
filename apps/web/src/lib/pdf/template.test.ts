import { describe, expect, it } from 'vitest';
import { fontBase64, fontFaceCss } from './template';

// The fonts are embedded at build time (scripts/gen-fonts.mjs -> fonts.generated.ts)
// because the Workers runtime has no filesystem. If a font entry is missing or
// empty, fontFaceCss() silently drops the @font-face and the PDF renders with
// fallback glyphs (broken Arabic shaping) — so assert each face is present.
describe('pdf font embedding', () => {
  const expectedFaces = [
    { family: 'IBM Plex Sans Arabic', weight: '400', file: 'IBMPlexSansArabic-Regular.ttf' },
    { family: 'IBM Plex Sans Arabic', weight: '700', file: 'IBMPlexSansArabic-Bold.ttf' },
    { family: 'Cairo', weight: '400 900', file: 'Cairo-Variable.ttf' },
  ];

  it('embeds a non-empty base64 payload for every font file', () => {
    for (const { file } of expectedFaces) {
      const base64 = fontBase64(file);
      expect(base64.length).toBeGreaterThan(0);
      // base64 alphabet only — proves it's a real payload, not a stray token.
      expect(base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
  });

  it('emits every @font-face block with an embedded data URI', () => {
    const css = fontFaceCss();
    for (const { family, weight } of expectedFaces) {
      expect(css).toContain(`font-family: '${family}'; font-weight: ${weight};`);
    }
    // One data URI per face, none empty.
    const dataUris = css.match(/url\(data:font\/ttf;base64,[A-Za-z0-9+/]+={0,2}\)/g);
    expect(dataUris).toHaveLength(expectedFaces.length);
  });
});
