import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// The PDF fonts are served as Workers static assets (public/fonts/*.ttf) and
// fetched via the ASSETS binding at render time, then base64-inlined as
// @font-face. If a face is missing or its base64 is empty, fontFaceCss() drops
// it and the PDF renders with fallback glyphs (broken Arabic shaping) — so this
// mocks the ASSETS binding with the real on-disk fonts and asserts each face is
// present with a non-empty data URI. (Live Arabic shaping is verified at deploy
// against the BROWSER binding.)
const fontsDir = fileURLToPath(new URL('../../../public/fonts/', import.meta.url));

vi.mock('@/lib/cf/context', () => ({
  cfEnv: () => ({
    ASSETS: {
      fetch: async (url: URL) => {
        const file = url.pathname.replace('/fonts/', '');
        const bytes = readFileSync(`${fontsDir}${file}`);
        return new Response(bytes, { status: 200 });
      },
    },
  }),
}));

const { fontFaceCss } = await import('./template');

describe('pdf font embedding', () => {
  const expectedFaces = [
    { family: 'IBM Plex Sans Arabic', weight: '400' },
    { family: 'IBM Plex Sans Arabic', weight: '700' },
    { family: 'Cairo', weight: '400 900' },
  ];

  it('emits every @font-face block with a non-empty embedded data URI', async () => {
    const css = await fontFaceCss();
    for (const { family, weight } of expectedFaces) {
      expect(css).toContain(`font-family: '${family}'; font-weight: ${weight};`);
    }
    // One data URI per face, none empty, base64 alphabet only.
    const dataUris = css.match(/url\(data:font\/ttf;base64,[A-Za-z0-9+/]+={0,2}\)/g);
    expect(dataUris).toHaveLength(expectedFaces.length);
  });
});
