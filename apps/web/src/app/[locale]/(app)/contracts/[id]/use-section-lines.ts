'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { loadSectionLines } from '@/lib/contracts/lines-actions';
import type { ContractLineView, ContractSectionSummary } from '@/lib/contracts/queries';

/**
 * One contract section's lines on the page: the ones it opened with, then a
 * page more each time "show lines" is pressed, asked of the server from the
 * last line shown. A refused or failed ask keeps what is shown and says why.
 */
export function useSectionLines(contractId: string, section: ContractSectionSummary) {
  const te = useTranslations('errors');
  const [lines, setLines] = useState<ContractLineView[]>(section.openingLines);
  const [hasMore, setHasMore] = useState(section.openingLines.length < section.lineCount);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    setFailure(null);
    const afterLineId = lines.length > 0 ? lines[lines.length - 1].id : null;
    startTransition(async () => {
      try {
        const result = await loadSectionLines({ contractId, sectionId: section.id, afterLineId });
        if (!result.ok || !result.data) {
          setFailure(describeFailure(result, te));
          return;
        }
        const page = result.data;
        setLines((shown) => [...shown, ...page.lines]);
        setHasMore(page.hasMore);
      } catch (rejection) {
        setFailure(describeRejection(rejection, te));
      }
    });
  }

  return {
    lines,
    hasMore,
    remaining: Math.max(section.lineCount - lines.length, 0),
    pending,
    failure,
    loadMore,
  };
}
