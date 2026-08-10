import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/brand/wordmark';
import { cn } from '@/lib/utils';

export interface AuthShellProps {
  children: ReactNode;
  showValueProp?: boolean;
  className?: string;
}

export function AuthShell({ children, showValueProp, className }: AuthShellProps) {
  const app = useTranslations('app');
  const home = useTranslations('home');
  const onboarding = useTranslations('onboarding');

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div
        className={cn(
          'grid w-full max-w-4xl overflow-hidden rounded-2xl border bg-card shadow-card',
          showValueProp && 'lg:grid-cols-2',
          className,
        )}
      >
        {showValueProp && (
          <div className="hidden flex-col justify-between gap-8 bg-gradient-to-br from-primary to-primary/80 p-10 text-primary-foreground lg:flex">
            <Wordmark size="lg" className="text-primary-foreground" />
            <div className="space-y-2">
              <p className="text-2xl font-semibold leading-snug">
                {home('tagline')}
              </p>
              <p className="text-primary-foreground/80">{home('intro')}</p>
            </div>
            <p className="text-sm text-primary-foreground/70">
              {onboarding('valueProp')}
            </p>
          </div>
        )}

        <div className="p-8">
          <div className="mb-6 space-y-1">
            <Wordmark size="md" />
            <p className="text-sm text-muted-foreground">{app('descriptor')}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
