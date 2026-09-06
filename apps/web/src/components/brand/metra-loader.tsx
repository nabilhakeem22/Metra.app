'use client';

import { useLocale, useTranslations } from 'next-intl';
import {
  WORDMARK_ARABIC,
  WORDMARK_LATIN,
} from '@/components/brand/wordmark-paths';
import { MetraMark } from '@/components/brand/wordmark';
import { cn } from '@/lib/utils';

/**
 * The full-screen brand loader: mark + halo + wordmark + progress bar.
 *
 * Reserved for a COLD arrival — app launch, a public portal opening, onboarding.
 * Route-to-route navigation inside the app uses skeletons instead, because a
 * full-screen brand animation on every click reads as the app restarting.
 *
 * The mark runs the 3s Trace loop and the bar runs a 1.6s sweep; the mismatch is
 * deliberate, so the screen doesn't feel like one metronome. Under reduced
 * motion everything freezes and the bar becomes a static segment.
 */
export function MetraLoader({ className }: { className?: string }) {
  const t = useTranslations('app');
  const locale = useLocale();
  const isRtl = locale === 'ar-EG';
  const glyphs = isRtl ? WORDMARK_ARABIC : WORDMARK_LATIN;
  const [, , vbW, vbH] = glyphs.viewBox.split(' ').map(Number);
  const height = 26;

  return (
    <div
      className={cn(
        'flex min-h-[60vh] flex-col items-center justify-center gap-[26px]',
        className,
      )}
      // The loader replaces content that is not there yet; announce it rather
      // than leaving a screen reader on a silent page.
      role="status"
      aria-live="polite"
      aria-label={t('loading')}
    >
      <div className="relative flex items-center justify-center">
        <div
          className="metra-halo absolute size-[132px] rounded-[40px]"
          style={{
            background:
              'radial-gradient(circle, var(--halo) 0%, transparent 70%)',
          }}
          aria-hidden
        />
        <MetraMark size={88} className="metra-trace-loop relative" />
      </div>

      <svg
        viewBox={glyphs.viewBox}
        width={(vbW / vbH) * height}
        height={height}
        fill="currentColor"
        aria-hidden
        className="shrink-0 text-[color:var(--text)]"
      >
        <path d={glyphs.d} />
      </svg>

      <div
        className="h-[3px] w-[148px] overflow-hidden rounded-[2px]"
        style={{ background: 'var(--track)' }}
        aria-hidden
      >
        <div
          className="metra-bar h-full w-[32%] rounded-[2px]"
          style={{ background: 'hsl(var(--brand))' }}
        />
      </div>
    </div>
  );
}
