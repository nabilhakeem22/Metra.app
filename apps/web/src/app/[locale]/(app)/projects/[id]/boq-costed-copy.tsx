'use client';

import { FileDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * The internal, costed copy of the BOQ.
 *
 * `buildBoqHtml` has rendered a `variant: 'internal'` with cost and margin
 * columns since the template shipped, and `boq-template.test.ts` sweeps the
 * client copy for every cost figure to prove it leaks none — but nothing routed
 * to it, so the document existed and could not be opened. This is that route.
 *
 * It sits QUIETLY beside Issue rather than competing with it: the client copy is
 * the document the studio is paid for, and this one is for the room where the
 * margin is discussed. Opened in a new tab rather than downloaded, because the
 * studio usually wants to look at it, not file it.
 */
export function BoqCostedCopy({
  boqId,
  documentNumber,
}: {
  boqId: string;
  /** `BQ-YYYY-NNNN`, server-formatted (`BoqDetail.documentNumber`). */
  documentNumber: string;
}) {
  const t = useTranslations('projects.profile.boq');
  return (
    <Button variant="secondary" size="sm" asChild>
      <a
        href={`/api/pdf/boq/${boqId}?variant=internal`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('costedCopyFor', { documentNumber })}
      >
        <FileDown className="size-4" aria-hidden />
        {t('costedCopy')}
      </a>
    </Button>
  );
}
