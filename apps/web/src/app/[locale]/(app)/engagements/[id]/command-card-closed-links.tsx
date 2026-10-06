'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import type { DesignState } from '@/lib/engagements/states';

/**
 * Where a delivery closed for EXECUTION goes next: the project's BOQ, and a
 * quotation for the build (for a role that may build one). The other endings
 * have nothing to link to.
 */
export function CommandCardClosedLinks({
  state,
  projectId,
  canStartQuotation,
}: {
  state: DesignState;
  projectId: string;
  canStartQuotation: boolean;
}) {
  const tclosed = useTranslations('engagements.command.closed.execution');
  if (state !== 'execution') return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link href={`/projects/${projectId}?tab=boq`}>{tclosed('viewBoq')}</Link>
      </Button>
      {canStartQuotation && (
        <Button asChild>
          <Link href={`/proposals/new?projectId=${projectId}`}>{tclosed('startQuotation')}</Link>
        </Button>
      )}
    </div>
  );
}
