'use client';

import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { usePathname, useRouter } from '@/i18n/routing';

export function LocaleSwitch({ className }: { className?: string }) {
  const t = useTranslations('home');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const target = locale === 'ar-EG' ? 'en' : 'ar-EG';

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      onClick={() => router.replace(pathname, { locale: target })}
      aria-label={t('localeName')}
    >
      <Languages className="size-4" aria-hidden />
      <span>{t('localeName')}</span>
    </Button>
  );
}
