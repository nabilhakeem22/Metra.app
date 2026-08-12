'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * A small "?" affordance next to a form field. The hint text is reachable by
 * hover, keyboard focus (Tab), AND tap (the trigger toggles open state). The
 * button carries an aria-label so screen readers announce it; when `id` is
 * given the tooltip content adopts it so the caller can point the field's
 * `aria-describedby` at the same id. Logical CSS only (ms-1, no left/right).
 */
export function FieldHint({
  hint,
  id,
  className,
}: {
  hint: string;
  id?: string;
  className?: string;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          type="button"
          aria-label={t('common.hint')}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'ms-1 inline-flex size-4 shrink-0 items-center justify-center border border-border text-[10px] font-semibold leading-none text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          ?
        </TooltipTrigger>
        <TooltipContent id={id}>{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
