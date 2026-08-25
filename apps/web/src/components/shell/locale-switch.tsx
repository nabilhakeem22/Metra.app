'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';

// Autonyms — always shown in the language's own script (used for the a11y label
// describing the language you switch TO).
const LOCALE_AUTONYM: Record<string, string> = {
  en: 'English',
  'ar-EG': 'العربية',
};

// The current locale's short badge + the currency symbol the money formatter
// already uses for that locale (EGP / ج.م). Clicking toggles the locale — same
// behaviour as before, reskinned to the top bar's glass pill.
const LOCALE_SHORT: Record<string, string> = {
  en: 'EN',
  'ar-EG': 'ع',
};

function currencySymbol(locale: string): string {
  return locale.startsWith('ar') ? 'ج.م' : 'EGP';
}

export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const target = locale === 'ar-EG' ? 'en' : 'ar-EG';
  const targetLabel = LOCALE_AUTONYM[target];
  const short = LOCALE_SHORT[locale] ?? locale.toUpperCase();

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: target })}
      aria-label={targetLabel}
      // Glass pill (fill + hairline only — no nested blur).
      className={
        'inline-flex items-center gap-1 rounded-full border px-[12px] py-[7px] text-[12px] font-semibold text-[color:var(--text)] outline-none focus-ring-brand transition-colors' +
        (className ? ` ${className}` : '')
      }
      style={{
        background: 'var(--glass)',
        borderColor: 'var(--glass-hairline)',
      }}
    >
      <span>{short}</span>
      <span aria-hidden style={{ color: 'var(--text-muted)' }}>
        ·
      </span>
      <span className="tabular">{currencySymbol(locale)}</span>
    </button>
  );
}
