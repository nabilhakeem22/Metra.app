'use client';

import { useTranslations } from 'next-intl';
import { StatusChip } from '@/components/ui/status-chip';
import type { BudgetBadge } from '@/lib/engagements/budget-badge';
import { ENGAGEMENT_TABS, type EngagementTab } from './tabs';

const TAB_BASE =
  'inline-flex items-center gap-1.5 rounded-item px-3.5 py-1.5 text-small transition-colors disabled:cursor-not-allowed disabled:opacity-60 coarse:min-h-11';
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
  /** A closed delivery wears no badges: nothing in it is waiting on the studio. */
  closed: boolean;
}

/** A tab wears a badge when it holds something ADDRESSED TO the studio. */
function badgeCountFor(
  tab: EngagementTab,
  props: EngagementTabStripProps,
): number {
  if (props.closed) return 0;
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
      className="flex flex-wrap gap-1 rounded-item p-1"
      style={{ background: 'var(--track)' }}
      role="tablist"
    >
      {ENGAGEMENT_TABS.map((tab) => {
        // Budget's badge is a STATE, not a count -- a range the studio has set and
        // the client has not yet acknowledged is unissued work sitting in that
        // tab, and saying so is worth more than saying "1".
        const budgetState =
          tab !== 'budget' || props.budget === null || props.closed ? null : props.budget;
        const badgeCount = badgeCountFor(tab, props);
        const active = props.tab === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            // LOCKED WHILE A WRITE IS IN FLIGHT. Switching tabs unmounts the open
            // panel under an answer that has not arrived, and a studio who cannot
            // see the form they submitted cannot tell what happened to it. The
            // KEY itself now survives the unmount (it is held in the store, not in
            // the panel), so what this prevents is the confusion, not a duplicate.
            // Safe to do only because `runAction` can no longer leave `pending`
            // stuck; before that this would have locked navigation permanently on
            // one failed action.
            disabled={props.pending}
            onClick={() => props.onSelect(tab)}
            className={`${TAB_BASE} ${active ? TAB_ACTIVE : TAB_IDLE}`}
          >
            {tp(tab)}
            {budgetState && (
              <StatusChip
                tone={budgetState === 'draft' ? 'draft' : 'waiting'}
                label={t(
                  budgetState === 'draft'
                    ? 'offPlan.budgetDraftBadge'
                    : 'offPlan.budgetAwaitingAckBadge',
                )}
              />
            )}
            {/* Something addressed TO the studio: its move. */}
            {badgeCount > 0 && (
              <StatusChip
                tone="yourMove"
                label={t(tab === 'files' ? 'questionsBadge' : 'paymentsBadge', { n: badgeCount })}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
