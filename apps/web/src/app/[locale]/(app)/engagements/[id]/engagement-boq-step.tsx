'use client';

import { ArrowRight, CheckCircle2, Table2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import {
  boqStepAction,
  boqStepHref,
  type BoqStepSummary,
} from '@/lib/boqs/step';

/**
 * The BOQ step's lead action in the cockpit.
 *
 * Before the structured BOQ existed, this step offered one thing: drop a file.
 * That still works — a studio may satisfy the gate with their own spreadsheet —
 * but it is no longer the thing we want them to reach for, because a file cannot
 * be measured against on site and cannot generate the execution contract.
 *
 * So this sits ABOVE the inline dropzone and states the priced-schedule path,
 * while the dropzone remains underneath as the escape hatch. The cockpit's rule
 * is one obvious next action; this makes the obvious one the one we built.
 */
export function EngagementBoqStep({
  projectId,
  summary,
}: {
  projectId: string;
  summary: BoqStepSummary | null;
}) {
  const t = useTranslations('engagements.boqStep');
  const action = boqStepAction(summary);

  if (action === 'done') {
    return (
      <div className="mb-4 flex items-center gap-2.5 rounded-[var(--r-panel)] border border-[color:var(--rule)] bg-[color:var(--track)] px-3.5 py-3">
        <CheckCircle2
          className="size-4 shrink-0"
          style={{ color: 'var(--success)' }}
          aria-hidden
        />
        <p className="text-[13.5px] text-[color:var(--text)]">
          {t('doneTitle', { count: String(summary?.lineCount ?? 0) })}
        </p>
        <Link
          href={boqStepHref(projectId)}
          className="ms-auto shrink-0 text-[13px] font-semibold text-brand-ink hover:underline"
        >
          {t('view')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-[var(--r-panel)] border border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)] px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Table2
          className="mt-0.5 size-4 shrink-0 text-brand-ink"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[color:var(--text)]">
            {action === 'issue' ? t('issueTitle') : t('startTitle')}
          </p>
          <p className="mt-0.5 text-[13px] text-[color:var(--text-muted)]">
            {action === 'issue'
              ? t('issueBody', { count: String(summary?.lineCount ?? 0) })
              : t('startBody')}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <Button asChild>
          <Link href={boqStepHref(projectId)}>
            {action === 'issue' ? t('issueCta') : t('startCta')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
