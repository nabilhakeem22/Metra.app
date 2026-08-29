'use client';

import { useTranslations } from 'next-intl';
import type { ActionResult } from '@/lib/actions/result';
import { setEngagementOffPlan } from '@/lib/engagements/actions';

// The proposal-stage OFF-PLAN toggle on the command card: two segmented options —
// an EXISTING unit (needs a site survey) vs OFF-PLAN (developer AutoCAD import).
// Capability-gated by the parent; flips `design_engagements.off_plan` through the
// shared `runAction` path (which refreshes on success). A one-line hint explains
// that the choice drives Step 2 (survey vs AutoCAD import). Logical CSS only so
// the segmented control mirrors in ar-EG RTL.
export function EngagementOffPlanToggle({
  engagementId,
  offPlan,
  pending,
  runAction,
}: {
  engagementId: string;
  offPlan: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements.offPlan');

  function set(next: boolean) {
    if (next === offPlan || pending) return;
    runAction(() => setEngagementOffPlan({ engagementId, offPlan: next }));
  }

  return (
    <div className="mt-4 border-t border-[color:var(--rule)] pt-4">
      <div
        className="inline-flex overflow-hidden rounded-[var(--r-item)] border border-[color:var(--rule)]"
        role="group"
      >
        <button
          type="button"
          aria-pressed={!offPlan}
          disabled={pending}
          onClick={() => set(false)}
          className={`px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed ${
            !offPlan
              ? 'bg-brand-tint text-brand-ink'
              : 'bg-card text-[color:var(--text-muted)] hover:bg-[color:var(--track)]'
          }`}
        >
          {t('existing')}
        </button>
        <button
          type="button"
          aria-pressed={offPlan}
          disabled={pending}
          onClick={() => set(true)}
          className={`border-s border-[color:var(--rule)] px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed ${
            offPlan
              ? 'bg-brand-tint text-brand-ink'
              : 'bg-card text-[color:var(--text-muted)] hover:bg-[color:var(--track)]'
          }`}
        >
          {t('offPlan')}
        </button>
      </div>
      <p className="mt-2 text-[12px] text-[color:var(--text-muted)]">{t('hint')}</p>
    </div>
  );
}
