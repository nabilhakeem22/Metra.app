'use client';

import { CheckCircle2, EyeOff, Lock, LockOpen } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatMoney } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import {
  boqProposalHref,
  boqStepHref,
  type BoqStepData,
  type BoqStepSummary,
} from '@/lib/boqs/step';

/** Whether the client can open the shared BOQ yet (the portal's BOQ rule). */
function BoqClientChip({ clientCanOpen }: { clientCanOpen: boolean }) {
  const t = useTranslations('engagements.boqStep');
  const ChipIcon = clientCanOpen ? LockOpen : Lock;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-caption font-medium"
      style={
        clientCanOpen
          ? { color: 'var(--success)', borderColor: 'var(--success)' }
          : { color: 'var(--warn)', borderColor: 'var(--warn)' }
      }
    >
      <ChipIcon className="size-3" aria-hidden />
      {clientCanOpen ? t('chipOpen') : t('chipLocked')}
    </span>
  );
}

/**
 * The BOQ was issued: which document, how much of it, and what the client has.
 * "Sent" (with the open/locked chip) ONLY when its PDF is visible in THIS
 * delivery's link; otherwise "issued, not shared with the client" (a BOQ issued
 * before every issue published, one hidden by hand, or one issued through
 * another delivery of the project). The document number comes from the SERVER
 * (`current`), never formatted here. "Edit and send a new version" reopens the
 * working copy.
 */
export function BoqStepDone({
  projectId,
  step,
  current,
}: {
  projectId: string;
  step: BoqStepData;
  current: BoqStepSummary;
}) {
  const t = useTranslations('engagements.boqStep');
  const locale = useLocale();
  const shared = step.sharedWithClient;
  const StateIcon = shared ? CheckCircle2 : EyeOff;

  return (
    <div className="mb-4 rounded-panel border border-[color:var(--rule)] bg-[color:var(--track)] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <StateIcon
          className="size-4 shrink-0"
          style={{ color: shared ? 'var(--success)' : 'var(--warn)' }}
          aria-hidden
        />
        <p className="text-small text-[color:var(--text)]">
          {t(shared ? 'doneTitle' : 'doneUnsharedTitle', {
            documentNumber: current.documentNumber,
            count: current.lineCount,
            n: formatNumber(current.lineCount, locale),
          })}
        </p>
        <span
          className="font-mono text-small tabular-nums text-[color:var(--text)]"
          dir="ltr"
          style={{ textAlign: 'end' }}
        >
          {formatMoney(current.total, locale)}
        </span>
        {shared && <BoqClientChip clientCanOpen={step.clientCanOpen} />}
      </div>
      {!shared && (
        <p className="mt-1 ps-[26px] text-small text-[color:var(--text-muted)]">
          {t('unsharedHint')}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 ps-[26px]">
        <Link
          href={boqStepHref(projectId)}
          className="text-small font-semibold text-brand-ink hover:underline"
        >
          {t('viewBoq')}
        </Link>
        {step.boqProposalId && step.canBuild && (
          <Link
            href={boqProposalHref(step.boqProposalId)}
            className="text-small font-semibold text-brand-ink hover:underline"
          >
            {t('editNewVersion')}
          </Link>
        )}
      </div>
    </div>
  );
}
