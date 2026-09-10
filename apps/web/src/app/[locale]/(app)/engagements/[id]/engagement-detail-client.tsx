'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import { countConceptOptions } from '@/lib/engagements/concept-options';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import type {
  EngagementArtifactRecord,
  EngagementChangeOrderRecord,
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementFeeSchedule,
  EngagementHeader,
  EngagementPayment,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import type { CommercialPulse } from '@/lib/engagements/pulse';
import type { Trigger } from '@/lib/engagements/transitions';
import { EngagementCommandCard } from './engagement-command-card';
import {
  EngagementPanels,
  type PanelCapabilities,
} from './engagement-panels';
import { ENGAGEMENT_TABS, type EngagementTab } from './tabs';
import { DELIVERY_SHARE_ANCHOR_ID } from './share-anchor';
import type { BoqStepSummary } from '@/lib/boqs/step';

// The cockpit's single-column body: the COMMAND CARD (what's next) on top, then
// the tabbed DETAIL region (Files · Timeline · Payments · Change orders — Files
// default). The old right rail is dissolved: its working files, fee ledger and
// activity now live inside those tabs, and so does every action that writes into
// them — the 'Log & manage' strip that used to sit here offered four equal
// choices an inch under a card whose whole premise is naming ONE next move. Each
// of those four now lives in the header of the tab holding its record. Pure
// composition over data the page already loaded; logical CSS only (RTL mirrors).
export function EngagementDetailClient({
  header,
  boqSummary,
  feeSchedule,
  payments,
  artifacts,
  events,
  changeOrders,
  transitions,
  clientActivity,
  nextActions,
  capabilities,
  canUpload,
  canShare,
  gatePreview,
  canAdvance,
  stallDays,
  pulse,
  paymentClaimCount,
  awaitingReplyCount,
}: {
  header: EngagementHeader;
  feeSchedule: EngagementFeeSchedule;
  payments: EngagementPayment[];
  artifacts: EngagementArtifactRecord[];
  events: EngagementEventRecord[];
  changeOrders: EngagementChangeOrderRecord[];
  transitions: EngagementTransitionRecord[];
  clientActivity: EngagementClientActivityRecord[];
  boqSummary: BoqStepSummary | null;
  nextActions: Trigger[];
  capabilities: PanelCapabilities;
  canUpload: boolean;
  canShare: boolean;
  gatePreview: EngagementGatePreview;
  canAdvance: boolean;
  stallDays: number | null;
  pulse: CommercialPulse;
  paymentClaimCount: number;
  /** Client Deliverables Step 2 — client questions still awaiting a studio reply,
   *  across every document on this engagement. Feeds the command card's quiet
   *  one-line prompt and the Files tab badge. */
  awaitingReplyCount: number;
}) {
  const t = useTranslations('engagements');
  const te = useTranslations('errors');
  const tp = useTranslations('engagements.panels');
  const router = useRouter();
  const [tab, setTab] = useState<EngagementTab>('files');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionCode | null>(null);
  // Guards the frame-sized window `pending` cannot -- see runAction below.
  const inFlight = useRef(false);

  // The Advance button owns the forward-advance trigger; every OTHER legal,
  // permitted trigger becomes a low-emphasis secondary control (no legal trigger
  // is dropped — Advance ∪ secondary = the capability-filtered legal set).
  const secondaryTriggers = nextActions.filter(
    (trigger) => trigger !== gatePreview.primaryTrigger,
  );

  // A band is set but nobody has acknowledged it yet -- unissued work sitting in
  // the Budget tab. Derived from data the page already holds; no extra read.
  const budgetDraft =
    header.romLow !== null &&
    header.romHigh !== null &&
    !events.some((e) => e.kind === 'rom_acknowledgement');

  // Pure derivation over the artifacts the page already loaded (no extra read).
  // The command card needs it to stop offering a 5th concept-option upload —
  // artifacts are append-only, so overshooting the guard's cap is unrecoverable.
  const conceptOptionCount = countConceptOptions(artifacts);

  /**
   * Run one server action and refresh on success. THE single entry point for
   * every write on this page -- all thirteen call sites reach the server through
   * here -- which is why both guards below belong here and not in a form.
   *
   * THE IN-FLIGHT REF CLOSES THE DOUBLE-SUBMIT WINDOW. `pending` comes from
   * `useTransition` and only flips on a SUBSEQUENT render, so two clicks inside
   * one frame both see `pending === false` and both dispatch. That was harmless
   * while these actions were idempotent column writes; it stopped being harmless
   * when they began appending to a ledger whose grants are INSERT and SELECT
   * only, so a duplicated row cannot be taken back. A ref is read and written
   * synchronously, so the second click in the same frame sees the first.
   *
   * It is HERE rather than in `FormActions` because only five of the thirteen
   * call sites are forms. The other eight -- Advance, the off-plan toggle, the
   * revision form, the payment form, every secondary trigger including the
   * terminal `abandon` -- would have been left open by a latch inside the form
   * component.
   *
   * THE try/catch IS LOAD-BEARING for the same controls. `pending` gates the
   * command card, all five tab headers and every panel form; if `fn()` REJECTS --
   * offline, a Worker rolling mid-request, a half-open origin -- an unguarded
   * transition never settles and all of them stay disabled with no way back but a
   * reload. A rejection is a transport failure rather than a coded refusal, so it
   * surfaces as `generic`; the action's own failures already return
   * `{ok:false, error}`. It is logged because otherwise it leaves no trace
   * anywhere: `mutateInOrg` never saw it, so the server has nothing either.
   *
   * `finally` releases the ref unconditionally. Tying the release to `pending`
   * instead would strand the page forever on any path where a transition never
   * starts.
   */
  function runAction(fn: () => Promise<ActionResult>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) router.refresh();
        else setError((res.error as ActionCode) ?? 'generic');
      } catch (cause) {
        console.error('engagement action failed before returning a result', cause);
        setError('generic');
      } finally {
        inFlight.current = false;
      }
    });
  }

  // Nudge = reveal the EXISTING client link. Scroll to (and focus) the delivery
  // share control rendered by the page above — no new server action, no notify.
  function revealShareLink() {
    const el = document.getElementById(DELIVERY_SHARE_ANCHOR_ID);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el?.focus?.();
  }

  return (
    <div className="space-y-4">
      <Link href="/engagements" className="text-sm text-primary hover:underline">
        {t('backToList')}
      </Link>

      <EngagementCommandCard
        engagementId={header.id}
        projectId={header.projectId}
        boqSummary={boqSummary}
        preview={gatePreview}
        state={header.state}
        allowances={{
          revisionCount: header.revisionCount,
          freeRevisionN: header.freeRevisionN,
          designRevisionCount: header.designRevisionCount,
          freeDesignRevisionN: header.freeDesignRevisionN,
        }}
        stallDays={stallDays}
        canAdvance={canAdvance}
        canRecordPayment={capabilities.recordPayment}
        canShare={canShare}
        canUpload={canUpload}
        canSetOffPlan={capabilities.setRom}
        offPlan={header.offPlan}
        paymentClaimCount={paymentClaimCount}
        awaitingReplyCount={awaitingReplyCount}
        conceptOptionCount={conceptOptionCount}
        clientActivity={clientActivity}
        secondaryTriggers={secondaryTriggers}
        pending={pending}
        runAction={runAction}
        onNudge={revealShareLink}
      />

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {resolveActionError(error, te)}
        </p>
      )}

      {/* A SEGMENTED control on a track, not an underline row: the active tab is a
          raised panel of the same material as the surface it reveals below, which
          is what makes the tab and its body read as one object. */}
      <div
        className="flex flex-wrap gap-1 rounded-[var(--r-item)] p-1"
        style={{ background: 'var(--track)' }}
        role="tablist"
      >
        {ENGAGEMENT_TABS.map((tb) => {
          // A tab wears a badge when it holds something ADDRESSED TO the studio:
          // a client payment claim to confirm, or a client question to answer.
          const badgeCount =
            tb === 'payments'
              ? paymentClaimCount
              : tb === 'files'
                ? awaitingReplyCount
                : 0;
          // Budget's badge is a STATE, not a count -- a range the studio has set
          // and the client has not yet acknowledged is unissued work sitting in
          // that tab, and saying so is worth more than saying "1".
          const draft = tb === 'budget' && budgetDraft;
          const active = tab === tb;
          return (
            <button
              key={tb}
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
              disabled={pending}
              onClick={() => setTab(tb)}
              className={`inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                active
                  ? 'bg-card font-bold text-[color:var(--text)] shadow-sm'
                  : 'font-medium text-[color:var(--text-muted)] hover:text-[color:var(--text)]'
              }`}
            >
              {tp(tb)}
              {draft && (
                <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] text-[color:var(--warn)]">
                  {t('budgetDraftBadge')}
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

      <EngagementPanels
        tab={tab}
        engagementId={header.id}
        canUpload={canUpload}
        capabilities={capabilities}
        pending={pending}
        runAction={runAction}
        data={{
          header,
          feeSchedule,
          payments,
          artifacts,
          events,
          changeOrders,
          transitions,
          clientActivity,
          pulse,
        }}
      />
    </div>
  );
}
