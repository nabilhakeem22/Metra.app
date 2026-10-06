'use client';

import { FileDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { flushPendingRemovals, hasPendingRemovals } from '@/hooks/pending-removals';

/**
 * A line deleted inside its Undo window is still on the server, and the PDF is
 * rendered from the server. So when one is pending, the tab is opened at once
 * (still inside the click, so no popup blocker objects), the deletes are
 * committed, and only then is the tab pointed at the document.
 */
async function openAfterPendingDeletes(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
  if (!hasPendingRemovals()) return;
  event.preventDefault();
  const href = event.currentTarget.href;
  const tab = window.open('about:blank', '_blank');
  await flushPendingRemovals();
  if (!tab) return;
  tab.opener = null;
  tab.location.href = href;
}

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
        onClick={(event) => void openAfterPendingDeletes(event)}
        aria-label={t('costedCopyFor', { documentNumber })}
      >
        <FileDown className="size-4" aria-hidden />
        {t('costedCopy')}
      </a>
    </Button>
  );
}
