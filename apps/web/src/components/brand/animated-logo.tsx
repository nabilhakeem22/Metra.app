'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Mark } from '@/components/brand/mark';
import { SnapLine } from '@/components/brand/snap-line';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { cn } from '@/lib/utils';

const SEEN_KEY = 'metra-logo-seen';

/**
 * Login-only entrance: the mark line-draws, the wordmark fades + translates up,
 * then a SnapLine underscore draws across. Runs once per session (sessionStorage),
 * skippable (any key/click completes), reduced-motion -> fully composed static.
 */
export function AnimatedLogo({
  runOnce = true,
  className,
}: {
  runOnce?: boolean;
  className?: string;
}) {
  const app = useTranslations('app');
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const seen = runOnce && sessionStorage.getItem(SEEN_KEY) === '1';
    if (seen || reduced) {
      setDone(true);
      return;
    }
    const complete = () => {
      setDone(true);
      sessionStorage.setItem(SEEN_KEY, '1');
    };
    const t1 = window.setTimeout(() => setPhase(1), 450);
    const t2 = window.setTimeout(() => setPhase(2), 820);
    const t3 = window.setTimeout(complete, 1400);
    window.addEventListener('keydown', complete, { once: true });
    window.addEventListener('pointerdown', complete, { once: true });
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener('keydown', complete);
      window.removeEventListener('pointerdown', complete);
    };
  }, [runOnce, reduced]);

  const composed = done || reduced;
  const showWord = composed || phase >= 1;
  const showSnap = composed || phase >= 2;

  return (
    <div className={cn('inline-flex items-center gap-3', className)}>
      <Mark size={40} animate={!composed} />
      <div>
        <span
          className={cn(
            'block text-3xl font-bold uppercase leading-none tracking-tight text-foreground transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none',
            showWord ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
          )}
        >
          {app('name')}
        </span>
        <SnapLine
          animate={!composed}
          className={cn(
            'mt-1.5 transition-opacity duration-200 motion-reduce:transition-none',
            showSnap ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
    </div>
  );
}
