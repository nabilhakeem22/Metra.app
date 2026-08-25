'use client';

import { HelpCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePathname, useRouter } from '@/i18n/routing';
import { stepsForPage } from '@/lib/onboarding/tour-steps';
import { useTour } from './tour/use-tour';

export function HelpMenu() {
  const t = useTranslations('help');
  const { start, goto } = useTour();
  const pathname = usePathname();
  const router = useRouter();
  const pageStep = stepsForPage(pathname)[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('menu')}
          // Glass icon button (fill + hairline only — no nested blur).
          className="inline-flex size-[34px] items-center justify-center rounded-[11px] border text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text)]"
          style={{
            background: 'var(--glass)',
            borderColor: 'var(--glass-hairline)',
          }}
        >
          <HelpCircle width={17} height={17} aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>{t('title')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            start();
          }}
        >
          {t('restartTour')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            router.push('/dashboard');
          }}
        >
          {t('openChecklist')}
        </DropdownMenuItem>
        {pageStep && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              goto(pageStep.id);
            }}
          >
            {t('howThisPage')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
