'use client';

import { ArrowRight, Table2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { boqStepHref } from '@/lib/boqs/step';

/**
 * An uploaded sheet is priced but still a draft: lead with reviewing and
 * issuing it on the project's BOQ tab. Unchanged by the builder path.
 */
export function BoqStepIssue({
  projectId,
  lineCount,
  clientCanOpen,
}: {
  projectId: string;
  lineCount: number;
  /** The portal's BOQ rule: says whether issuing hands it over openable. */
  clientCanOpen: boolean;
}) {
  const t = useTranslations('engagements.boqStep');
  return (
    <div className="mb-4 rounded-panel border border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)] px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Table2 className="mt-0.5 size-4 shrink-0 text-brand-ink" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-[color:var(--text)]">
            {t('issueTitle')}
          </p>
          <p className="mt-0.5 text-small text-[color:var(--text-muted)]">
            {t(clientCanOpen ? 'issueBodyOpen' : 'issueBody', { count: String(lineCount) })}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <Button asChild>
          <Link href={boqStepHref(projectId)}>
            {t('issueCta')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
