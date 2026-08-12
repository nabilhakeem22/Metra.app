'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { coachmarkKey, inlineStartOffset } from './coachmark-logic';
import { useTour } from './use-tour';

export function Coachmark({ paused = false }: { paused?: boolean }) {
  const { current, next, prev, stop, index, total } = useTour();
  const pathname = usePathname();
  const t = useTranslations();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const onPage = !!current && current.page === pathname;

  // Locate the anchor, measure it, and keep it measured (scroll/resize/observer).
  // A missing anchor after a short retry window self-skips (never throws).
  useEffect(() => {
    if (!current || !onPage || paused) {
      setRect(null);
      return;
    }
    let raf = 0;
    let tries = 0;
    let ro: ResizeObserver | null = null;
    let el: HTMLElement | null = null;
    const measure = () => {
      if (el) setRect(el.getBoundingClientRect());
    };
    const find = () => {
      el = document.querySelector<HTMLElement>(`[data-tour="${current.anchor}"]`);
      if (el) {
        measure();
        ro = new ResizeObserver(measure);
        ro.observe(el);
      } else if (tries++ < 30) {
        raf = requestAnimationFrame(find);
      } else {
        next(); // self-skip: anchor absent on this page
      }
    };
    find();
    const onScroll = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [current, onPage, paused, next]);

  // Focus trap + keyboard control.
  useEffect(() => {
    if (!rect) return;
    const card = cardRef.current;
    if (!card) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    card.focus();
    const onKey = (e: KeyboardEvent) => {
      const action = coachmarkKey(e.key);
      if (action === 'stop') {
        e.preventDefault();
        stop();
      } else if (action === 'next') {
        e.preventDefault();
        next();
      } else if (action === 'prev') {
        e.preventDefault();
        prev();
      } else if (action === 'tab') {
        const f = card.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        );
        if (f.length === 0) {
          e.preventDefault();
          return;
        }
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prevFocus?.focus?.();
    };
  }, [rect, next, prev, stop]);

  if (!mounted || !current || !onPage || paused || !rect) return null;

  const reduced =
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const rtl = document.documentElement.dir === 'rtl';
  const pad = 6;
  // Logical inset — the distance from the INLINE-START edge (flips in RTL).
  const insetStart = inlineStartOffset(
    rect.left,
    rect.right,
    rtl,
    window.innerWidth,
  );
  const titleId = `tour-${current.id}-title`;
  const isLast = index >= total - 1;

  return createPortal(
    <>
      <div
        aria-hidden
        className="fixed inset-0 z-[60] bg-foreground/30"
        style={{ pointerEvents: 'none' }}
      />
      <div
        aria-hidden
        className={cn(
          'fixed z-[61] rounded-lg border-2 border-primary',
          !reduced && 'transition-all',
        )}
        style={{
          top: rect.top - pad,
          insetInlineStart: insetStart - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          pointerEvents: 'none',
        }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed z-[62] w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-4 shadow-lg focus:outline-none"
        style={{ top: rect.bottom + 10, insetInlineStart: insetStart }}
      >
        <p id={titleId} className="text-sm font-semibold">
          {t(current.titleKey)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t(current.bodyKey)}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {t('tour.stepOf', { current: index + 1, total })}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={stop}>
              {t('tour.skip')}
            </Button>
            {index > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={prev}>
                {t('tour.back')}
              </Button>
            )}
            <Button type="button" size="sm" onClick={next}>
              {isLast ? t('tour.done') : t('tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
