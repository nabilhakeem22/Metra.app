'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { dismissChecklist } from '@/lib/onboarding/state';
import { cn } from '@/lib/utils';

export interface GettingStartedProps {
  profileComplete: boolean;
  teamInvited: boolean;
  dismissed: boolean;
  orgId: string;
}

export function GettingStarted({
  profileComplete,
  teamInvited,
  dismissed: initialDismissed,
  orgId,
}: GettingStartedProps) {
  const t = useTranslations('dashboard');
  const nav = useTranslations('nav');
  const [dismissed, setDismissed] = useState(initialDismissed);
  const [, startTransition] = useTransition();

  if (dismissed) return null;

  const items = [
    { key: 'taskCompleteProfile', done: profileComplete, soon: false },
    { key: 'taskInviteTeammate', done: teamInvited, soon: false },
    { key: 'taskImportPriceBook', done: false, soon: true },
    { key: 'taskFirstProposal', done: false, soon: true },
  ] as const;

  function dismiss() {
    setDismissed(true);
    startTransition(() => {
      void dismissChecklist(orgId);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>{t('gettingStartedTitle')}</CardTitle>
          <CardDescription>{t('gettingStartedSubtitle')}</CardDescription>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {t('dismiss')}
        </button>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-4">
          {/* Trace line — the quote->invoice traceability motif. Logical start-3
              so it flips in RTL; bullets sit above it. */}
          <span
            aria-hidden
            className="absolute inset-y-3 start-3 w-px bg-border"
          />
          {items.map((item) => (
            <li key={item.key} className="relative flex items-start gap-3">
              <span
                className={cn(
                  'z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card',
                  item.done && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {item.done ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <span className="size-2 rounded-full bg-muted-foreground/40" />
                )}
              </span>
              <div className="flex flex-1 items-center gap-2">
                <p
                  className={cn(
                    'text-sm font-medium',
                    item.done && 'text-muted-foreground line-through',
                  )}
                >
                  {t(item.key)}
                </p>
                {item.soon && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {nav('soon')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
