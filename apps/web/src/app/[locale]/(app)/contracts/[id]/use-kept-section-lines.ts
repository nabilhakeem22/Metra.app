'use client';

import { useState } from 'react';
import type { ContractLinesPage } from '@/lib/contracts/queries';

/** The lines each section has loaded so far, by section id, held above the tabs. */
export interface KeptSectionLines {
  of: (sectionId: string) => ContractLinesPage | undefined;
  keep: (sectionId: string, page: ContractLinesPage) => void;
}

/**
 * Held by the contract detail client, ABOVE the tab switch: the overview
 * unmounts when the variation register is shown, and the lines a person paged
 * in must still be there when they come back.
 */
export function useKeptSectionLines(): KeptSectionLines {
  const [kept, setKept] = useState<Record<string, ContractLinesPage>>({});
  return {
    of: (sectionId) => kept[sectionId],
    keep: (sectionId, page) => setKept((current) => ({ ...current, [sectionId]: page })),
  };
}
