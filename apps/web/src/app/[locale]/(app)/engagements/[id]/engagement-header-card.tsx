'use client';

import { BellRing, Link2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { DeliveryStatusChip } from '@/components/engagements/delivery-status-chip';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import { StatusChip } from '@/components/ui/status-chip';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import type { EngagementHeader } from '@/lib/engagements/queries';
import { isTerminal } from '@/lib/engagements/states';
import { formatDate } from '@/lib/format/date';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { formatMoney } from '@/lib/format/money';
import type { StatusTone } from '@/lib/ui/status-tone';
import { ClientLinkDialog } from './client-link-dialog';
import { DeliveryReminderDialog } from './delivery-reminder-dialog';
import { EngagementHeaderCrumbs, type HeaderCrumbs } from './engagement-header-crumbs';
import { openDeliveryReminder, revealDeliveryShareLink } from './share-anchor';

// The cockpit HEADER. Row 1: the trail (Deliveries / client / project) ending in
// the document number, on a quiet mono line. Row 2: the delivery named at heading
// weight, with the client-link state and the page's menu at the inline-END.
// Row 3: a chip row of what is true about it.
//
// The trail lives here rather than on a row of its own above the card, and the
// client link lives in the menu rather than in a bar under it: both used to push
// the command card, the thing the studio came to act on, down the page.
//
// Every chip is derived from data this product HOLDS. The design mockup this
// follows also drew a delivery-branch chip and an assignee, and neither is built:
// the branch is not decided until `execution_decision` (six stages after the one
// the mockup illustrates) and there is no assignee column on `design_engagements`.
// Inventing them would put two confident falsehoods at the top of the page.
//
// `shared` reuses the page's existing delivery share status (no new query).
// Logical CSS only (inline-start/end) so it mirrors in ar-EG RTL.
export function EngagementHeaderCard({
  header,
  status,
  shared,
  canShare,
  crumbs,
}: {
  header: EngagementHeader;
  /** The delivery's status: the same chip the deliveries list and dashboard show. */
  status: DeliveryStatus;
  shared: boolean;
  /** Owner/admin (`engagements_issue` approve): the menu, its client link and the reminder. */
  canShare: boolean;
  crumbs: HeaderCrumbs;
}) {
  const t = useTranslations('engagements');
  const tc = useTranslations('engagements.command');
  const tcommon = useTranslations('common');
  const locale = useLocale();

  const docNumber = formatDocNumber(
    'DE',
    header.number,
    docYear(null, header.createdAt),
  );
  const started = formatDate(header.createdAt, locale);
  const remindable = !isTerminal(header.state);
  const feeLabel = header.designFee
    ? tc('feeChip', { amount: formatMoney(header.designFee, locale) })
    : null;

  // On the StatusChip tones, beside the status chip itself, so the row speaks
  // one colour language: brand is the status chip's alone ("your move"). A
  // locked concept is a finished step (done). "As-built due" is a fact with no
  // date behind it, not an overdue task, so it is neutral, like the rest.
  type Chip = { key: string; label: string; tone: StatusTone };
  const flags = [
    header.offPlan && { key: 'offPlan', label: t('offPlan.offPlan'), tone: 'neutral' },
    header.asBuiltDue && { key: 'asBuiltDue', label: t('asBuiltDue'), tone: 'neutral' },
    header.conceptLockedAt && { key: 'conceptLocked', label: t('conceptLocked'), tone: 'done' },
  ].filter(Boolean) as Chip[];

  // The chips the mockup draws that this product does NOT model, and so are not
  // invented here: the delivery BRANCH ("Design + execution") is not decided until
  // `execution_decision`, six stages after the Concept the mockup shows, and there
  // is no assignee column on design_engagements at all, so the owner chip has no
  // source. The real flags take their place -- off-plan, as-built due, concept
  // locked -- which are true and which the mockup had no way to know about.
  const chips = [
    feeLabel && { key: 'fee', label: feeLabel, tone: 'neutral' },
    { key: 'started', label: tc('startedOn', { date: started }), tone: 'neutral' },
    ...flags,
  ].filter(Boolean) as Chip[];

  return (
    <header>
      <EngagementHeaderCrumbs crumbs={crumbs} docNumber={docNumber} />

      <div className="mt-1 flex flex-wrap items-start gap-x-4 gap-y-2">
        <h1 className="min-w-0 flex-1 text-heading font-bold leading-tight text-[color:var(--text)] text-balance">
          {crumbs.clientName}
          {/* `·` not a dash: a dash is not Arabic punctuation, and this line
              renders in ar-EG (scripts/i18n/style-guide.md rule 6). */}
          <span aria-hidden> · </span>
          <span className="font-bold">{crumbs.projectName}</span>
        </h1>
        {/* The link's state stays a STATUS; what you can do with it is in the
            menu beside it. */}
        <div className="flex shrink-0 items-center gap-2">
          <StatusChip
            tone={shared ? 'done' : 'neutral'}
            label={shared ? tc('clientLinkActive') : tc('clientLinkInactive')}
          />
          {canShare && (
            <>
              <OverflowMenu
                label={tcommon('moreActions')}
                actions={[
                  {
                    key: 'clientLink',
                    label: tc('clientLink'),
                    icon: Link2,
                    onSelect: revealDeliveryShareLink,
                  },
                  // A closed delivery has nobody to remind.
                  ...(remindable
                    ? [
                        {
                          key: 'sendReminder',
                          label: tc('sendReminder'),
                          icon: BellRing,
                          onSelect: openDeliveryReminder,
                        },
                      ]
                    : []),
                ]}
              />
              <ClientLinkDialog engagementId={header.id} initialShared={shared} />
              {remindable && <DeliveryReminderDialog engagementId={header.id} />}
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <DeliveryStatusChip status={status} />
        {chips.map((chip) => (
          <StatusChip key={chip.key} tone={chip.tone} label={chip.label} />
        ))}
      </div>
    </header>
  );
}
