'use client';

import { useTranslations } from 'next-intl';
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

export function Wordmark({ className, size = 'md' }: WordmarkProps) {
  const t = useTranslations('app');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-bold tracking-tight text-foreground',
        SIZE[size],
        className,
      )}
    >
      <span
        aria-hidden
        className="inline-block size-2.5 rounded-md bg-gradient-to-br from-primary to-accent"
      />
      {t('name')}
    </span>
  );
}
