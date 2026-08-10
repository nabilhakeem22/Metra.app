'use client';

import { Languages } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter } from '@/i18n/routing';

// Autonyms — always shown in the language's own script.
const LOCALE_AUTONYM: Record<string, string> = {
  en: 'English',
  'ar-EG': 'العربية',
};

export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const target = locale === 'ar-EG' ? 'en' : 'ar-EG';
  // Label with the language you'll switch TO (the target autonym).
  const targetLabel = LOCALE_AUTONYM[target];

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      onClick={() => router.replace(pathname, { locale: target })}
      aria-label={targetLabel}
    >
      <Languages className="size-4" aria-hidden />
      <span>{targetLabel}</span>
    </Button>
  );
}
