import type { ReactNode } from 'react';
import { SectionLabel } from '@/components/ui/section-label';
import type { CommandCardChrome } from '@/lib/engagements/command-card-chrome';

// The STEP CARD: the cockpit command card's chrome, shared by every phase. NOT
// 'use client', no hooks: what it says arrives translated, and what it offers
// arrives as children, so the design card keeps its own act region inside it.

/**
 * The card: a 4px accent stripe on the inline-START (it mirrors to the
 * inline-END in ar-EG RTL), the phase rail in one tinted band, then the body.
 * Whose move it is lives in the header's status chip and the card only wears its
 * colour (lib/engagements/command-card-chrome.ts); it is never said a second
 * time here.
 */
export function StepCard({ chrome, rail, children }: { chrome: CommandCardChrome; rail: ReactNode; children: ReactNode }) {
  return (
    <section className={`glass relative overflow-hidden p-0 text-[color:var(--text)] ${chrome.borderClass}`}>
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 z-10 w-1 ${chrome.stripeClass}`}
        style={{ insetInlineStart: 0 }}
      />
      <div className="border-b border-[color:var(--rule)] px-5 pb-4 pt-5 sm:px-6" style={{ background: 'var(--track)' }}>
        {rail}
      </div>
      <div className="px-5 pb-5 pt-5 sm:px-6">{children}</div>
    </section>
  );
}

/** The step's one action in words: an eyebrow naming who acts, the headline, and why. */
export function StepHeadline({
  eyebrow,
  headline,
  hint,
}: {
  eyebrow: string | null;
  headline: string;
  hint: string | null;
}) {
  return (
    <>
      {eyebrow && <SectionLabel className="mb-1.5">{eyebrow}</SectionLabel>}
      <h2 className="mb-1 text-heading font-semibold leading-tight text-balance">{headline}</h2>
      {hint && <p className="mb-4 text-small text-[color:var(--text-muted)]">{hint}</p>}
    </>
  );
}
