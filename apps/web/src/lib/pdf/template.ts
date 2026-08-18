import { cfEnv, isCloudflareRuntime } from '@/lib/cf/context';

// The three PDF webfonts live in `public/fonts/*.ttf`, which OpenNext copies into
// the Workers static-assets output (served via the ASSETS binding, NOT bundled
// into the Worker script — that keeps the base64 out of the 3 MiB script limit).
// At render time we fetch each font through ASSETS, base64-encode it, and inline
// it as an @font-face data URI so Arabic shaping is identical to the old bundled
// path. The Workers runtime has no filesystem, so fetching from ASSETS is the
// runtime-safe replacement for the previous fs read.
const FONT_FACES: ReadonlyArray<{
  family: string;
  weight: string;
  file: string;
}> = [
  { family: 'IBM Plex Sans Arabic', weight: '400', file: 'IBMPlexSansArabic-Regular.ttf' },
  { family: 'IBM Plex Sans Arabic', weight: '700', file: 'IBMPlexSansArabic-Bold.ttf' },
  { family: 'Cairo', weight: '400 900', file: 'Cairo-Variable.ttf' },
];

// Encoded @font-face CSS is fetched/encoded once per isolate and memoised, so
// repeated PDF renders in the same Worker don't re-fetch or re-base64 the fonts.
let cachedFontFaceCss: string | null = null;

async function fontBase64(file: string): Promise<string> {
  // Off-platform (next dev / Node PDF preview / Vitest) there is no ASSETS
  // binding and cfEnv()/getCloudflareContext() THROWS, so guard first and
  // degrade to the fallback family rather than crash the render. ASSETS is also
  // optional in the merged CloudflareEnv type, so tolerate a missing binding.
  if (!isCloudflareRuntime()) return '';
  const assets = cfEnv().ASSETS;
  if (!assets) return '';
  try {
    // `assets.local` is an arbitrary same-origin base for the ASSETS fetch; only
    // the path (/fonts/<file>) selects the served asset.
    const response = await assets.fetch(
      new URL(`/fonts/${file}`, 'https://assets.local'),
    );
    if (!response.ok) return '';
    const bytes = new Uint8Array(await response.arrayBuffer());
    return Buffer.from(bytes).toString('base64');
  } catch {
    // A transient ASSETS error (rejected fetch / arrayBuffer) must degrade to the
    // fallback font, not bubble up and turn the PDF route into a 500.
    return '';
  }
}

/**
 * Shared @font-face block (IBM Plex Sans Arabic + Cairo, base64-embedded from the
 * static-asset TTFs). Emits a face only when its file actually loaded, so a
 * missing/unreachable asset degrades to the fallback family instead of throwing
 * or emitting a broken URI — same contract as the old bundled path.
 */
export async function fontFaceCss(): Promise<string> {
  if (cachedFontFaceCss !== null) return cachedFontFaceCss;
  const faces = await Promise.all(
    FONT_FACES.map(async ({ family, weight, file }) => {
      const b64 = await fontBase64(file);
      return b64
        ? `@font-face { font-family: '${family}'; font-weight: ${weight};
    src: url(data:font/ttf;base64,${b64}) format('truetype'); }`
        : '';
    }),
  );
  const css = faces.filter(Boolean).join('\n');
  // Only memoise a complete result: if a face failed to load (missing asset),
  // don't poison the isolate cache — retry the fetch on the next render.
  if (faces.every(Boolean)) cachedFontFaceCss = css;
  return css;
}
