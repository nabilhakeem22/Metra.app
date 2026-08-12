'use client';

import { useTranslations } from 'next-intl';
import { Mark } from '@/components/brand/mark';
import { cn } from '@/lib/utils';

export interface WordmarkProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE: Record<NonNullable<WordmarkProps['size']>, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
};

const MARK_PX: Record<NonNullable<WordmarkProps['size']>, number> = {
  sm: 20,
  md: 24,
  lg: 28,
};

/** The Metra lock-up: the Snap Line mark + the wordmark. */
export function Wordmark({ className, size = 'md' }: WordmarkProps) {
  const t = useTranslations('app');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-bold uppercase tracking-tight text-foreground',
        SIZE[size],
        className,
      )}
    >
      <Mark size={MARK_PX[size]} />
      {t('name')}
    </span>
  );
}
