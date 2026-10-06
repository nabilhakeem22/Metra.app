'use client';

import { ArrowRight, Loader2, Table2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { boqProposalHref, boqStepHref, type BoqStepData } from '@/lib/boqs/step';
import { useOpenBoqProposal } from './use-open-boq-proposal';

/**
 * Nothing priced yet: lead with building the BOQ in the proposal builder
 * ("Create", or "Continue" once the working copy exists), with the uploaded
 * Excel sheet as the small second path. Both are hidden from a role that may
 * not build; the inline dropzone below stays either way.
 */
export function BoqStepStart({
  engagementId,
  projectId,
  step,
}: {
  engagementId: string;
  projectId: string;
  step: BoqStepData;
}) {
  const t = useTranslations('engagements.boqStep');
  const { open, pending } = useOpenBoqProposal(engagementId);

  return (
    <div className="mb-4 rounded-panel border border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)] px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Table2 className="mt-0.5 size-4 shrink-0 text-brand-ink" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-[color:var(--text)]">
            {t('startTitle')}
          </p>
          <p className="mt-0.5 text-small text-[color:var(--text-muted)]">
            {t('startBody')}
          </p>
        </div>
      </div>
      {step.canBuild && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {step.boqProposalId ? (
            <Button variant="default" asChild>
              <Link href={boqProposalHref(step.boqProposalId)}>
                {t('continueCta')}
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button variant="default" disabled={pending} onClick={open}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
              )}
              {t('createCta')}
            </Button>
          )}
          <Link
            href={boqStepHref(projectId)}
            className="text-small font-medium text-brand-ink hover:underline"
          >
            {t('uploadInstead')}
          </Link>
        </div>
      )}
    </div>
  );
}
