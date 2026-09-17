'use client';

import { useTranslations } from 'next-intl';
import type { BudgetBadge } from '@/lib/engagements/budget-badge';
import { ENGAGEMENT_TABS, type EngagementTab } from './tabs';

const TAB_BASE =
  'inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const TAB_ACTIVE = 'bg-card font-bold text-[color:var(--text)] shadow-sm';
const TAB_IDLE =
  'font-medium text-[color:var(--text-muted)] hover:text-[color:var(--text)]';

export interface EngagementTabStripProps {
  tab: EngagementTab;
  onSelect: (tab: EngagementTab) => void;
  /** A client payment claim to confirm — addressed TO the studio. */
  paymentClaimCount: number;
  /** A client question still awaiting a studio reply. */
  awaitingReplyCount: number;
  budget: BudgetBadge;
  /** True while a write is in flight. See the comment on `disabled` below. */
  pending: boolean;
}

/** A tab wears a badge when it holds something ADDRESSED TO the studio. */
function badgeCountFor(
  tab: EngagementTab,
  props: EngagementTabStripProps,
): number {
  if (tab === 'payments') return props.paymentClaimCount;
  if (tab === 'files') return props.awaitingReplyCount;
  return 0;
}

/**
 * A SEGMENTED control on a track, not an underline row: the active tab is a
 * raised panel of the same material as the surface it reveals below, which is
 * what makes the tab and its body read as one object.
 */
export function EngagementTabStrip(props: EngagementTabStripProps) {
  const t = useTranslations('engagements');
  const tp = useTranslations('engagements.panels');
  return (
    <div
      className="flex flex-wrap gap-1 rounded-[var(--r-item)] p-1"
      style={{ background: 'var(--track)' }}
      role="tablist"
    >
      {ENGAGEMENT_TABS.map((tab) => {
        // Budget's badge is a STATE, not a count -- a range the studio has set and
        // the client has not yet acknowledged is unissued work sitting in that
        // tab, and saying so is worth more than saying "1".
        const budgetState =
          tab !== 'budget' || props.budget === null
            ? null
            : t(
                props.budget === 'draft'
                  ? 'offPlan.budgetDraftBadge'
                  : 'offPlan.budgetAwaitingAckBadge',
              );
        const badgeCount = badgeCountFor(tab, props);
        const active = props.tab === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            // LOCKED WHILE A WRITE IS IN FLIGHT. Navigating away unmounts the
            // open panel -- and with it `PaymentPanel`'s per-mount idempotency
            // key, so a submit whose response was lost would come back on a
            // FRESH key and land as a genuine duplicate against an append-only
            // ledger. Safe to do only because `runAction` can no longer leave
            // `pending` stuck; before that this would have locked navigation
            // permanently on one failed action.
            disabled={props.pending}
            onClick={() => props.onSelect(tab)}
            className={`${TAB_BASE} ${active ? TAB_ACTIVE : TAB_IDLE}`}
          >
            {tp(tab)}
            {budgetState && (
              <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--warn)]">
                {budgetState}
              </span>
            )}
            {badgeCount > 0 && (
              <span
                className="inline-flex items-center rounded-[var(--r-pill)] bg-[color:var(--warn-tint)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--warn)]"
                dir="ltr"
              >
                {t('paymentsBadge', { n: badgeCount })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
