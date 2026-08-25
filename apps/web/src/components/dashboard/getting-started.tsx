'use client';

import { Check, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useTour } from '@/components/onboarding/tour/use-tour';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import type { ChecklistResult } from '@/lib/onboarding/checklist';
import { dismissChecklist } from '@/lib/onboarding/state';
import { cn } from '@/lib/utils';

export interface GettingStartedProps {
  result: ChecklistResult;
  orgId: string;
  dismissed: boolean;
}

export function GettingStarted({
  result,
  orgId,
  dismissed: initialDismissed,
}: GettingStartedProps) {
  const t = useTranslations('onboarding');
  const { goto } = useTour();
  const [dismissed, setDismissed] = useState(initialDismissed);
  const [, startTransition] = useTransition();

  if (dismissed || result.allDone) return null;

  function dismiss() {
    setDismissed(true);
    startTransition(() => {
      void dismissChecklist(orgId);
    });
  }

  // A role with no create grants gets a role-appropriate line, never prompts.
  if (result.items.length === 0) {
    return (
      // Flat (opaque bg-card, no .glass) so the onboarding surface never spends
      // blur budget on the dashboard. Header carries no divider with no content.
      <Card flat data-tour="dashboard-checklist">
        <CardHeader className="border-b-0">
          <CardTitle>{t('readOnlyTitle')}</CardTitle>
          <CardDescription>{t('readOnlyBody')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    // Flat (opaque bg-card, no .glass) so the onboarding surface never spends
    // blur budget on the dashboard.
    <Card flat data-tour="dashboard-checklist">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {t('dismiss')}
        </button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {t('progress', { percent: result.percent })}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
              style={{ width: `${result.percent}%` }}
            />
          </div>
        </div>

        <ol className="relative space-y-4">
          <span aria-hidden className="absolute inset-y-3 start-3 w-px bg-border" />
          {result.items.map((item) => (
            <li key={item.key} className="relative flex flex-wrap items-center gap-3">
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
              <p
                className={cn(
                  'flex-1 text-sm font-medium',
                  item.done && 'text-muted-foreground line-through',
                )}
              >
                {t(`items.${item.key}`)}
              </p>
              {!item.done && (
                <div className="flex items-center gap-2">
                  {item.tourStep && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => goto(item.tourStep as string)}
                    >
                      <Play className="size-4" aria-hidden />
                      {t('launch')}
                    </Button>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href={item.href}>{t('open')}</Link>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
