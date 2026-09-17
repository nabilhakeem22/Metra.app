'use client';

import { useTranslations } from 'next-intl';
import { useEffect, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { coachmarkKey } from './coachmark-logic';

const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

export interface CoachmarkControls {
  next: () => void;
  prev: () => void;
  stop: () => void;
}

/**
 * Focus trap + keyboard control.
 *
 * The card takes focus on open and gives it back on close, and Tab cycles INSIDE
 * it — a modal the keyboard can walk out of is a modal that is not one. Esc
 * stops, arrows and Enter move; the mapping itself is `coachmarkKey`, which is
 * pure and tested.
 */
function useCoachmarkFocusTrap(
  cardRef: RefObject<HTMLDivElement | null>,
  active: boolean,
  controls: CoachmarkControls,
): void {
  const { next, prev, stop } = controls;
  useEffect(() => {
    if (!active) return;
    const card = cardRef.current;
    if (!card) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    card.focus();

    const onKey = (event: KeyboardEvent) => {
      const action = coachmarkKey(event.key);
      if (action === 'stop' || action === 'next' || action === 'prev') {
        event.preventDefault();
        if (action === 'stop') stop();
        else if (action === 'next') next();
        else prev();
        return;
      }
      if (action !== 'tab') return;
      const focusable = card.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [cardRef, active, next, prev, stop]);
}

export function CoachmarkCard({
  cardRef,
  step,
  position,
  index,
  total,
  controls,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  step: { id: string; titleKey: string; bodyKey: string };
  position: { top: number; insetInlineStart: number };
  index: number;
  total: number;
  controls: CoachmarkControls;
}) {
  const t = useTranslations();
  useCoachmarkFocusTrap(cardRef, true, controls);
  const titleId = `tour-${step.id}-title`;
  const isLast = index >= total - 1;
  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed z-[62] w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-4 shadow-lg focus:outline-none"
      style={position}
    >
      <p id={titleId} className="text-sm font-semibold">
        {t(step.titleKey)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{t(step.bodyKey)}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t('tour.stepOf', { current: index + 1, total })}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={controls.stop}>
            {t('tour.skip')}
          </Button>
          {index > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={controls.prev}>
              {t('tour.back')}
            </Button>
          )}
          <Button type="button" size="sm" onClick={controls.next}>
            {isLast ? t('tour.done') : t('tour.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
