'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { HeroGroup } from '@/lib/engagements/portal-hero';
import type { BudgetPart } from '@/lib/engagements/review-outcome';
import { bidiIsolate } from '@/lib/format/bidi';

/** The confirmation an acted-on hero button resolves to (names the next phase). */
export type HeroOutcome = 'approved' | 'changes' | 'acknowledged';

/** Which `delivery.hero.<group>` title/body keys each outcome confirms with. */
const CONFIRM_KEYS = {
  approved: { title: 'approvedTitle', body: 'approvedBody', notified: 'approvedBodyNotified' },
  changes: { title: 'changesTitle', body: 'changesBody', notified: 'changesBodyNotified' },
  acknowledged: {
    title: 'acknowledgedTitle',
    body: 'acknowledgedBody',
    notified: 'acknowledgedBodyNotified',
  },
} as const satisfies Record<HeroOutcome, { title: string; body: string; notified: string }>;

/** The `delivery.hero.design` line on the budget half of a one-tap approve+budget. */
const BUDGET_LINE_KEY = {
  acknowledged: 'budgetAcknowledged',
  changed: 'budgetReviewAgain',
  failed: 'budgetNotSaved',
} as const satisfies Record<BudgetPart, string>;

/**
 * The hero once the client has acted. It says the designer HAS BEEN NOTIFIED
 * only when the studio really was (`studioNotified`, from the portal action);
 * otherwise it says the answer is recorded and the designer will see it, which
 * is always true. After a concept CHOICE it first names the option chosen, in
 * the letter the client tapped. After the one-tap approve+budget it says how
 * the budget half ended: confirmed, changed since the page loaded (review the
 * new range below), or not saved (confirm it from the budget card).
 */
export function HeroConfirmed({
  group,
  outcome,
  studioNotified,
  chosenLetter,
  budget,
}: {
  group: HeroGroup;
  outcome: HeroOutcome;
  studioNotified: boolean;
  chosenLetter?: string;
  /** The one-tap approve+budget: how its budget half ended. */
  budget?: BudgetPart;
}) {
  const tGroup = useTranslations(`delivery.hero.${group}`);
  const tDesign = useTranslations('delivery.hero.design');
  const tPicker = useTranslations('delivery.conceptPicker');
  const keys = CONFIRM_KEYS[outcome];
  return (
    <section className="rounded-panel border border-[color:var(--success)]/30 bg-[color:var(--success-tint)] p-5 text-center shadow-sm">
      <CheckCircle2 className="mx-auto mb-3 size-11 text-[color:var(--success)]" aria-hidden />
      <h2 className="text-title font-semibold text-foreground">{tGroup(keys.title)}</h2>
      {chosenLetter && (
        <p className="mt-2 text-body font-medium text-foreground">
          {tPicker('chosen', { letter: bidiIsolate(chosenLetter) })}
        </p>
      )}
      <p className="mx-auto mt-2 max-w-xs text-body text-muted-foreground">
        {tGroup(studioNotified ? keys.notified : keys.body)}
      </p>
      {budget && (
        <p className="mx-auto mt-2 max-w-xs text-body font-medium text-foreground">{tDesign(BUDGET_LINE_KEY[budget])}</p>
      )}
    </section>
  );
}
