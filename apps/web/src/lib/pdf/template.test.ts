import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The PDF fonts are served as Workers static assets (public/fonts/*.ttf) and
// fetched via the ASSETS binding at render time, then base64-inlined as
// @font-face. Each case remocks `@/lib/cf/context` and re-imports ./template so
// the per-isolate font cache doesn't bleed across cases.
const fontsDir = fileURLToPath(new URL('../../../public/fonts/', import.meta.url));

interface CfContextMock {
  isCloudflareRuntime: () => boolean;
  cfEnv: () => { ASSETS?: { fetch: (url: URL) => Promise<Response> } };
}

async function loadTemplateWith(context: CfContextMock) {
  vi.resetModules();
  vi.doMock('@/lib/cf/context', () => context);
  return import('./template');
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/cf/context');
});

const onPlatformWithRealFonts: CfContextMock = {
  isCloudflareRuntime: () => true,
  cfEnv: () => ({
    ASSETS: {
      fetch: async (url: URL) => {
        const file = url.pathname.replace('/fonts/', '');
        const bytes = readFileSync(`${fontsDir}${file}`);
        return new Response(bytes, { status: 200 });
      },
    },
  }),
};

describe('pdf font embedding', () => {
  const expectedFaces = [
    { family: 'IBM Plex Sans Arabic', weight: '400' },
    { family: 'IBM Plex Sans Arabic', weight: '700' },
    { family: 'Cairo', weight: '400 900' },
  ];

  it('emits every @font-face block with a non-empty embedded data URI', async () => {
    const { fontFaceCss } = await loadTemplateWith(onPlatformWithRealFonts);
    const css = await fontFaceCss();
    for (const { family, weight } of expectedFaces) {
      expect(css).toContain(`font-family: '${family}'; font-weight: ${weight};`);
    }
    // One data URI per face, none empty, base64 alphabet only.
    const dataUris = css.match(/url\(data:font\/ttf;base64,[A-Za-z0-9+/]+={0,2}\)/g);
    expect(dataUris).toHaveLength(expectedFaces.length);
  });

  // A2 — a rejecting ASSETS.fetch must degrade to the fallback font, not throw.
  it('degrades to an empty face block when ASSETS.fetch rejects (no throw)', async () => {
    const { fontFaceCss } = await loadTemplateWith({
      isCloudflareRuntime: () => true,
      cfEnv: () => ({
        ASSETS: {
          fetch: async () => {
            throw new Error('transient ASSETS failure');
          },
        },
      }),
    });
    await expect(fontFaceCss()).resolves.toBe('');
  });

  // A2 — off-platform cfEnv()/getCloudflareContext() throws; the guard must skip
  // it and degrade rather than crash the Node PDF preview.
  it('degrades to an empty face block off-platform without calling cfEnv', async () => {
    let cfEnvCalled = false;
    const { fontFaceCss } = await loadTemplateWith({
      isCloudflareRuntime: () => false,
      cfEnv: () => {
        cfEnvCalled = true;
        throw new Error('getCloudflareContext() called off-platform');
      },
    });
    await expect(fontFaceCss()).resolves.toBe('');
    expect(cfEnvCalled).toBe(false);
  });
});
