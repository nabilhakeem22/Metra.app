import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the fonts dir across dev (cwd = apps/web) and bundled server output.
function fontsDir(): string {
  const candidates = [
    (() => {
      try {
        return resolve(dirname(fileURLToPath(import.meta.url)), 'fonts');
      } catch {
        return '';
      }
    })(),
    resolve(process.cwd(), 'src/lib/pdf/fonts'),
    resolve(process.cwd(), 'apps/web/src/lib/pdf/fonts'),
  ];
  for (const dir of candidates) {
    if (dir && existsSync(resolve(dir, 'IBMPlexSansArabic-Regular.ttf'))) {
      return dir;
    }
  }
  // Not found — callers degrade to fallback fonts rather than crashing the
  // render (the in-app preview still shows; the browser has its own fonts).
  return '';
}

export function fontBase64(file: string): string {
  const dir = fontsDir();
  if (!dir) return '';
  try {
    return readFileSync(resolve(dir, file)).toString('base64');
  } catch {
    return '';
  }
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
