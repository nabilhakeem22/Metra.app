import { useLocale, useTranslations } from 'next-intl';
import { screenImage, screenLanguageOf, type ScreenImage, type ScreenKind } from './feature-screens';

/** The captures a card shows: its screen in the page's language, or for the
 *  bilingual card the same screen in both, Arabic first. */
function imagesOf(kind: ScreenKind, locale: string): ScreenImage[] {
  if (kind === 'bilingual') return [screenImage(kind, 'ar'), screenImage(kind, 'en')];
  return [screenImage(kind, screenLanguageOf(locale))];
}

/** The alt text key of one capture; the bilingual pair names each language. */
function altKeyOf(kind: ScreenKind, image: ScreenImage): string {
  if (kind !== 'bilingual') return `shots.${kind}`;
  return image.language === 'ar' ? 'shots.bilingualAr' : 'shots.bilingualEn';
}

/** A real Metra screen in a window frame, for one feature card. */
export function FeatureScreen({ kind }: { kind: ScreenKind }) {
  const t = useTranslations('landing.features');
  const images = imagesOf(kind, useLocale());

  return (
    <div className="landing-screen">
      <div className="landing-screen-top" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className={images.length > 1 ? 'landing-screen-body is-pair' : 'landing-screen-body'}>
        {images.map((image) => (
          <img
            key={image.src}
            src={image.src}
            width={image.width}
            height={image.height}
            alt={t(altKeyOf(kind, image))}
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
    </div>
  );
}
