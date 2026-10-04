'use client';

import { CheckCircle2, Lock, LockOpen } from 'lucide-react';
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

/**
 * The BOQ was sent: which document, how much of it, and whether the client can
 * open it yet. The document number comes from the SERVER (`current`), never
 * formatted here. "Edit and send a new version" reopens the working copy.
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
  const ChipIcon = step.clientCanOpen ? LockOpen : Lock;

  return (
    <div className="mb-4 rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-[color:var(--track)] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <CheckCircle2 className="size-4 shrink-0" style={{ color: 'var(--success)' }} aria-hidden />
        <p className="text-[13.5px] text-[color:var(--text)]">
          {t('doneTitle', {
            documentNumber: current.documentNumber,
            count: current.lineCount,
            n: formatNumber(current.lineCount, locale),
          })}
        </p>
        <span
          className="font-mono text-[13px] tabular-nums text-[color:var(--text)]"
          dir="ltr"
          style={{ textAlign: 'end' }}
        >
          {formatMoney(current.total, locale)}
        </span>
        <span
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-medium"
          style={
            step.clientCanOpen
              ? { color: 'var(--success)', borderColor: 'var(--success)' }
              : { color: 'var(--warn)', borderColor: 'var(--warn)' }
          }
        >
          <ChipIcon className="size-3" aria-hidden />
          {step.clientCanOpen ? t('chipOpen') : t('chipLocked')}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 ps-[26px]">
        <Link
          href={boqStepHref(projectId)}
          className="text-[13px] font-semibold text-brand-ink hover:underline"
        >
          {t('viewBoq')}
        </Link>
        {step.boqProposalId && step.canBuild && (
          <Link
            href={boqProposalHref(step.boqProposalId)}
            className="text-[13px] font-semibold text-brand-ink hover:underline"
          >
            {t('editNewVersion')}
          </Link>
        )}
      </div>
    </div>
  );
}
