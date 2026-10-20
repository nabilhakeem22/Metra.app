'use client';

import { useState } from 'react';
import type { ContractSectionsPage } from '@/lib/contracts/queries';

/** The sections the page has loaded so far, in order, held above the tabs. */
export interface KeptSections {
  /** Null until the first page is loaded: the page opened on another tab. */
  page: ContractSectionsPage | null;
  /** Add the next page after the ones shown (the first one when none is). */
  append: (next: ContractSectionsPage) => void;
}

/**
 * Held by the contract detail client, ABOVE the tab switch, beside the kept
 * lines (./use-kept-section-lines.ts): the overview unmounts when another tab
 * is shown, and the sections a person paged in must still be there when they
 * come back, without asking for them again. `opening` is what the server read
 * for an overview it opened on; null when the page opened on another tab.
 */
export function useKeptSections(opening: ContractSectionsPage | null): KeptSections {
  const [page, setPage] = useState<ContractSectionsPage | null>(opening);
  return {
    page,
    // Idempotent: a page that lands twice (the overview left and came back while
    // its first ask was still out) adds each section once.
    append: (next) =>
      setPage((current) => {
        const shown = current?.sections ?? [];
        const known = new Set(shown.map((section) => section.id));
        return { sections: [...shown, ...next.sections.filter((section) => !known.has(section.id))], hasMore: next.hasMore };
      }),
  };
}
