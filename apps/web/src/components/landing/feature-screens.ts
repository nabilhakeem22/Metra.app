// The real product screens the feature bento shows: one WebP per screen and
// language under public/landing/, captured from the app with demo data. Each
// entry carries the file's own pixel size, so the <img> reserves its box before
// it loads (no layout shift). Re-capture a screen, and its size here changes too.

export type ScreenKind = 'flow' | 'cost' | 'proposals' | 'bilingual';

/** The language a capture is in: the app's two locales, by their file suffix. */
export type ScreenLanguage = 'ar' | 'en';

interface ScreenSize {
  width: number;
  height: number;
}

const SIZES: Record<ScreenKind, Record<ScreenLanguage, ScreenSize>> = {
  flow: { ar: { width: 1169, height: 808 }, en: { width: 1169, height: 787 } },
  cost: { ar: { width: 1180, height: 1305 }, en: { width: 1180, height: 1300 } },
  proposals: { ar: { width: 976, height: 1032 }, en: { width: 976, height: 1062 } },
  bilingual: { ar: { width: 585, height: 644 }, en: { width: 585, height: 638 } },
};

export interface ScreenImage extends ScreenSize {
  src: string;
  language: ScreenLanguage;
}

/** The capture of `kind` in `language`. */
export function screenImage(kind: ScreenKind, language: ScreenLanguage): ScreenImage {
  return { src: `/landing/feature-${kind}.${language}.webp`, language, ...SIZES[kind][language] };
}

/** A page locale's capture language: English for `en`, Arabic for every other. */
export function screenLanguageOf(locale: string): ScreenLanguage {
  return locale === 'en' ? 'en' : 'ar';
}
