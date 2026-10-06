import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The root every route skeleton renders: ONE status region named "Loading", so
 * a screen reader hears that the page is on its way instead of a run of empty
 * blocks. Server-safe: `useTranslations` works in a non-async server component.
 */
export function SkeletonRoot({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations('app');
  return (
    <div role="status" aria-label={t('loading')} className={cn('space-y-6', className)}>
      {children}
    </div>
  );
}
