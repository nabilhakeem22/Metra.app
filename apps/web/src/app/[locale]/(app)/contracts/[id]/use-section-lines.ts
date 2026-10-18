'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { describeReadFailure, type ShownFailure } from '@/lib/actions/error-message';
import { loadSectionLines } from '@/lib/contracts/lines-actions';
import type { ContractSectionSummary } from '@/lib/contracts/queries';
import type { KeptSectionLines } from './use-kept-section-lines';

/** Why the last ask failed; `gone` when the section is not this workspace's to show any more. */
export interface SectionLinesFailure {
  message: string;
  gone: boolean;
}

/**
 * One contract section's lines on the page: the ones it opened with, then a
 * page more each time "show lines" is pressed, asked of the server from the
 * last line shown and kept above the tabs (use-kept-section-lines.ts). One ask
 * at a time: a second press while one is in flight does nothing. A failed ask
 * keeps what is shown, the count and the button, and says why.
 */
export function useSectionLines(contractId: string, section: ContractSectionSummary, kept: KeptSectionLines) {
  const te = useTranslations('errors');
  const t = useTranslations('contracts.lines');
  const shown = kept.of(section.id) ?? {
    lines: section.openingLines,
    hasMore: section.openingLines.length < section.lineCount,
  };
  const [failure, setFailure] = useState<SectionLinesFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  const fail = (shownFailure: ShownFailure) => {
    const gone = 'error' in shownFailure && shownFailure.error === 'record_not_found';
    setFailure({ message: gone ? t('gone') : describeReadFailure(shownFailure, te, t('loadFailed')), gone });
  };

  function loadMore() {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailure(null);
    const afterLineId = shown.lines.length > 0 ? shown.lines[shown.lines.length - 1].id : null;
    startTransition(async () => {
      try {
        const result = await loadSectionLines({ contractId, sectionId: section.id, afterLineId });
        if (result.ok && result.data) {
          kept.keep(section.id, { lines: [...shown.lines, ...result.data.lines], hasMore: result.data.hasMore });
        } else {
          fail(result);
        }
      } catch (rejection) {
        fail({ rejection });
      } finally {
        inFlight.current = false;
      }
    });
  }

  return {
    lines: shown.lines,
    hasMore: shown.hasMore,
    remaining: Math.max(section.lineCount - shown.lines.length, 0),
    pending,
    failure,
    loadMore,
  };
}
