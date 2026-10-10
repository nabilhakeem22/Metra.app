'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/** How long "Copied" stays on the button. */
export const COPIED_FOR_MS = 2000;

type CopyState = 'idle' | 'copied' | 'failed';

/** Select the text of `element`, so a client whose browser refused the
 *  clipboard can copy it by hand. */
function selectText(element: HTMLElement | null): void {
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (!element || !selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * One payment instruction: its label, its value as PLAIN TEXT (never a link,
 * whatever the studio typed; left-to-right, Latin digits as written) and a
 * 44 px Copy button. "Copied" shows for two seconds; when the browser refuses
 * the clipboard the value is selected instead and a line says so.
 */
export function CopyValueRow({ label, value }: { label: string; value: string }) {
  const t = useTranslations('delivery.payments.instructions');
  const valueRef = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      selectText(valueRef.current);
      setState('failed');
    }
  }

  return (
    <div className="border-t py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-caption text-muted-foreground">{label}</p>
          <span ref={valueRef} dir="ltr" className="block break-all font-mono text-body font-semibold tabular-nums">
            {value}
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={t('copyLabel', { label })}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-pill border px-3 text-caption font-semibold outline-none focus-ring-brand hover:bg-muted"
        >
          {state === 'copied' ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          <span aria-live="polite">{state === 'copied' ? t('copied') : t('copy')}</span>
        </button>
      </div>
      {state === 'failed' && (
        <p role="status" className="mt-1 text-caption text-muted-foreground">
          {t('copyFailed')}
        </p>
      )}
    </div>
  );
}
