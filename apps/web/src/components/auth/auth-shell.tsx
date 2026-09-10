import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/brand/wordmark';
import { cn } from '@/lib/utils';

export interface AuthShellProps {
  children: ReactNode;
  showValueProp?: boolean;
  className?: string;
}

/**
 * The signed-out shell: a brand panel beside the form.
 *
 * IT SAID EVERYTHING TWICE. The wordmark rendered in BOTH panels, and
 * `app.descriptor` is byte-identical to `home.tagline` -- so the same sentence
 * appeared on both halves of one screen. Below it, `home.intro` and
 * `onboarding.valueProp` made the same promise again in different words. Four
 * near-identical pieces of copy competing on a screen whose entire job is to
 * collect one email address.
 *
 * The brand is now stated ONCE. The panel carries the wordmark and one line; the
 * form side leads straight with "Sign in". The wordmark reappears on the form
 * side only below `lg`, where the panel is hidden and the page would otherwise
 * carry no brand at all.
 */
export function AuthShell({ children, showValueProp, className }: AuthShellProps) {
  const home = useTranslations('home');

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div
        className={cn(
          // Commit to elevation (shadow), not a border + wide shadow together.
          'grid w-full max-w-4xl overflow-hidden rounded-2xl bg-card shadow-card',
          showValueProp && 'lg:grid-cols-2',
          className,
        )}
      >
        {showValueProp && (
          <div className="hidden flex-col justify-between gap-10 bg-primary p-10 text-primary-foreground lg:flex">
            <Wordmark size="lg" animate className="text-primary-foreground" />
            <p className="text-balance text-[26px] font-semibold leading-snug tracking-[-0.02em]">
              {home('tagline')}
            </p>
            {/* ONE supporting line, not two. The concrete promise earns the
                space; the abstract restatement of it does not. */}
            <p className="text-[15px] leading-relaxed text-primary-foreground/85">
              {home('intro')}
            </p>
          </div>
        )}

        <div className="p-8 sm:p-10">
          {/* Only where the brand panel is not: below `lg` this is the one place
              the product names itself. */}
          <div className="mb-7 lg:hidden">
            <Wordmark size="md" />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
