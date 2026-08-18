import { FONT_B64 } from './fonts.generated';

export function fontBase64(file: string): string {
  // Fonts are embedded at build time (see scripts/gen-fonts.mjs) because the
  // Workers runtime has no filesystem. A missing entry degrades to the fallback
  // family rather than throwing — same contract as the old fs-read path.
  return FONT_B64[file] ?? '';
}

/**
 * Shared @font-face block (IBM Plex Sans Arabic + Cairo, base64-embedded).
 * Emits a face only when its file actually loaded, so a missing fonts dir
 * degrades to the fallback family instead of throwing / emitting a broken URI.
 */
export function fontFaceCss(): string {
  const face = (family: string, weight: string, file: string): string => {
    const b64 = fontBase64(file);
    return b64
      ? `@font-face { font-family: '${family}'; font-weight: ${weight};
    src: url(data:font/ttf;base64,${b64}) format('truetype'); }`
      : '';
  };
  return [
    face('IBM Plex Sans Arabic', '400', 'IBMPlexSansArabic-Regular.ttf'),
    face('IBM Plex Sans Arabic', '700', 'IBMPlexSansArabic-Bold.ttf'),
    face('Cairo', '400 900', 'Cairo-Variable.ttf'),
  ]
    .filter(Boolean)
    .join('\n');
}
