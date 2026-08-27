'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format/money';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { pickPortalLabel } from '@/lib/engagements/portal-labels';
import type {
  PublicDelivery,
  PublicDeliveryMilestone,
} from '@/lib/engagements/public';
import { recordDeliveryAction } from './actions';

/**
 * The session-less, mobile-first, firm-branded client portal view. Phase 2 adds
 * the client action controls (approve / request changes / acknowledge) driven by
 * the SDF-computed `clientActions` verbs — APPEND-ONLY advisory signals that move
 * no state. Every figure is a client-facing amount (fee due / budget band); no
 * cost, margin, or internal state ever reaches this surface (the SDF omits them
 * physically). Bilingual, RTL-safe, Western numerals, logical CSS only.
 */
export function PublicDeliveryView({
  token,
  delivery,
}: {
  token: string;
  delivery: PublicDelivery | null;
}) {
  const t = useTranslations('delivery');
  const locale = useLocale();

  if (!delivery) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-2">
          <p className="text-lg font-semibold">{t('notFound.title')}</p>
          <p className="text-sm text-muted-foreground">{t('notFound.body')}</p>
        </div>
      </div>
    );
  }

  const wantAr = locale.startsWith('ar');
  const pick = (ar: string | null, en: string | null) =>
    (wantAr ? ar || en : en || ar) ?? '';
  const m = (v: string | null) => (v ? formatMoney(v, locale) : '');
  const firmName = pick(delivery.firm.nameAr, delivery.firm.nameEn) || 'Metra';
  const title = pick(delivery.titleAr, delivery.titleEn);
  const clientName = pick(delivery.client.nameAr, delivery.client.nameEn);
  const num = formatDocNumber('DE', delivery.number, docYear(null, delivery.createdAt));

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-lg space-y-4 p-4 md:py-8">
        {/* Firm branding */}
        <header className="flex items-center gap-3 rounded-xl border bg-background p-4 shadow-sm">
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg font-bold text-primary"
            aria-hidden
          >
            {firmName.trim().charAt(0) || 'M'}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{firmName}</p>
            {clientName && (
              <p className="truncate text-sm text-muted-foreground">
                {t('forClient', { name: clientName })}
              </p>
            )}
          </div>
        </header>

        {/* Delivery identity + prominent stage */}
        <section className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground" dir="ltr">
              {num}
            </p>
          </div>
          {title && <h1 className="text-lg font-semibold">{title}</h1>}
          <div className="rounded-lg bg-primary/5 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">
              {t('stageEyebrow')}
            </p>
            <p className="mt-0.5 text-base font-semibold">
              {pickPortalLabel(delivery.stageLabel, locale)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {pickPortalLabel(delivery.stageNote, locale)}
            </p>
          </div>
        </section>

        {/* Budget range (client-acknowledged band) */}
        {delivery.rom && (delivery.rom.low || delivery.rom.high) && (
          <section className="space-y-1 rounded-xl border bg-background p-4 shadow-sm">
            <h2 className="text-sm font-semibold">{t('budget.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('budget.hint')}</p>
            <p className="pt-1 font-medium" dir="ltr">
              {delivery.rom.low && delivery.rom.high
                ? t('budget.range', {
                    low: m(delivery.rom.low),
                    high: m(delivery.rom.high),
                  })
                : m(delivery.rom.low ?? delivery.rom.high)}
            </p>
          </section>
        )}

        {/* Payment schedule — amounts DUE only */}
        {delivery.paymentSchedule.length > 0 && (
          <section className="space-y-2 rounded-xl border bg-background p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('payments.title')}</h2>
              {delivery.designFeeTotal && (
                <span className="text-sm text-muted-foreground" dir="ltr">
                  {t('payments.total')}: {m(delivery.designFeeTotal)}
                </span>
              )}
            </div>
            <ul className="divide-y">
              {delivery.paymentSchedule.map((row) => (
                <MilestoneRow key={row.milestone_kind} row={row} m={m} />
              ))}
            </ul>
          </section>
        )}

        {/* Client action controls — append-only advisory signals */}
        <ActionsPanel token={token} clientActions={delivery.clientActions} />

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          {t('poweredBy', { firm: firmName })}
        </footer>
      </div>
    </div>
  );
}

/** The outcome a confirmed group renders (maps to a bilingual confirmation line). */
type ActionOutcome = 'approved' | 'changes' | 'acknowledged';

interface ActionButtonSpec {
  verb: string;
  labelKey: string;
  outcome: ActionOutcome;
  variant?: 'default' | 'outline';
}

interface ActionGroupSpec {
  id: string;
  titleKey: string;
  buttons: ActionButtonSpec[];
}

/**
 * Build the action groups from the SDF-computed verbs. Approve + request-changes
 * share one group (server-side they are mutually exclusive — recording either
 * drops BOTH from the next `clientActions`), so confirming one hides the pair.
 */
function groupsFor(clientActions: string[]): ActionGroupSpec[] {
  const has = (verb: string) => clientActions.includes(verb);
  const groups: ActionGroupSpec[] = [];
  if (has('approve_concept') || has('request_concept_changes')) {
    groups.push({
      id: 'concept',
      titleKey: 'conceptTitle',
      buttons: [
        { verb: 'approve_concept', labelKey: 'approveConcept', outcome: 'approved' },
        {
          verb: 'request_concept_changes',
          labelKey: 'requestConceptChanges',
          outcome: 'changes',
          variant: 'outline',
        },
      ],
    });
  }
  if (has('approve_design') || has('request_design_changes')) {
    groups.push({
      id: 'design',
      titleKey: 'designTitle',
      buttons: [
        { verb: 'approve_design', labelKey: 'approveDesign', outcome: 'approved' },
        {
          verb: 'request_design_changes',
          labelKey: 'requestDesignChanges',
          outcome: 'changes',
          variant: 'outline',
        },
      ],
    });
  }
  if (has('acknowledge_rom')) {
    groups.push({
      id: 'rom',
      titleKey: 'romTitle',
      buttons: [
        { verb: 'acknowledge_rom', labelKey: 'acknowledgeRom', outcome: 'acknowledged' },
      ],
    });
  }
  if (has('acknowledge_handoff')) {
    groups.push({
      id: 'handoff',
      titleKey: 'handoffTitle',
      buttons: [
        {
          verb: 'acknowledge_handoff',
          labelKey: 'acknowledgeHandoff',
          outcome: 'acknowledged',
        },
      ],
    });
  }
  return groups;
}

function ActionsPanel({
  token,
  clientActions,
}: {
  token: string;
  clientActions: string[];
}) {
  const groups = groupsFor(clientActions);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <ActionGroupCard key={group.id} token={token} group={group} />
      ))}
    </div>
  );
}

const CONFIRMED_KEY: Record<ActionOutcome, string> = {
  approved: 'confirmedApproved',
  changes: 'confirmedChanges',
  acknowledged: 'confirmedAcknowledged',
};

function ActionGroupCard({
  token,
  group,
}: {
  token: string;
  group: ActionGroupSpec;
}) {
  const t = useTranslations('delivery.actions');
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(verb: string, verbOutcome: ActionOutcome) {
    setError(null);
    startTransition(async () => {
      // Wrap the await so a rejected action can never leave the spinner stuck.
      try {
        const res = await recordDeliveryAction(token, verb, note);
        // `already` resolves ok:true (idempotent) — treat as a confirmed signal.
        if (res.ok) setOutcome(verbOutcome);
        else setError(res.error ?? 'generic');
      } catch {
        setError('generic');
      }
    });
  }

  return (
    <section className="space-y-3 rounded-xl border bg-background p-4 shadow-sm">
      <h2 className="text-sm font-semibold">{t(group.titleKey)}</h2>
      {outcome ? (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
          {t(CONFIRMED_KEY[outcome])}
        </p>
      ) : (
        <>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder={t('notePlaceholder')}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap gap-2">
            {group.buttons.map((button) => (
              <Button
                key={button.verb}
                variant={button.variant ?? 'default'}
                disabled={pending}
                onClick={() => submit(button.verb, button.outcome)}
              >
                {pending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                {t(button.labelKey)}
              </Button>
            ))}
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {t(`error.${error}`)}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function MilestoneRow({
  row,
  m,
}: {
  row: PublicDeliveryMilestone;
  m: (v: string | null) => string;
}) {
  const t = useTranslations('delivery');
  const statusTone =
    row.status === 'paid'
      ? 'bg-emerald-100 text-emerald-700'
      : row.status === 'partial'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-muted text-muted-foreground';
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {t(`milestone.${row.milestone_kind}`)}
        </p>
        <span
          className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-xs ${statusTone}`}
        >
          {t(`status.${row.status}`)}
        </span>
      </div>
      <span className="shrink-0 text-sm font-semibold" dir="ltr">
        {m(row.amount_due)}
      </span>
    </li>
  );
}
