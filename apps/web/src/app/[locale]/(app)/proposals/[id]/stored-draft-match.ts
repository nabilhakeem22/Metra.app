// Is the draft stored on the server exactly what this tab last sent? PURE and
// CLIENT-SAFE.
//
// A save can commit and still lose its answer (a dropped connection, a Worker cut
// off). The tab then holds the old revision, and its next save is refused
// `draft_changed_elsewhere` although nobody else wrote. When the stored draft
// matches the save whose answer was lost, that commit was this tab's own: it
// adopts the stored revision and ids and carries on. Anything else is a real
// conflict. Figures compare as numbers (the server stores "12.0000" for "12");
// text the save sent as null was the server's to fill (a price-book name) and is
// not compared; neither is a cost the caller does not see.
import type { ProposalDetail } from '@/lib/proposals/queries';
import type { ProposalPayload } from './proposal-payload';

type StoredDraft = Pick<ProposalDetail, 'revision' | 'discountPct' | 'taxRate' | 'supervisionPct' | 'sections'>;

const sameFigure = (stored: string | null | undefined, sent: string | null) =>
  sent === null || stored === undefined || Number(stored) === Number(sent);

const sameText = (stored: string | null, sent: string | null) => sent === null || stored === sent;

export function storedDraftMatches(stored: StoredDraft, sent: ProposalPayload): boolean {
  const headerFigures = ['discountPct', 'taxRate', 'supervisionPct'] as const;
  if (!headerFigures.every((figure) => sameFigure(stored[figure], sent.header[figure]))) return false;
  if (stored.sections.length !== sent.sections.length) return false;
  return sent.sections.every((section, sectionIndex) => {
    const storedSection = stored.sections[sectionIndex];
    if ((storedSection.titleEn ?? null) !== section.titleEn) return false;
    if ((storedSection.titleAr ?? null) !== section.titleAr) return false;
    if (storedSection.lines.length !== section.lines.length) return false;
    return section.lines.every((line, lineIndex) => {
      const storedLine = storedSection.lines[lineIndex];
      return (
        storedLine.costItemId === line.costItemId &&
        storedLine.unit === line.unit &&
        sameText(storedLine.descriptionEn, line.descriptionEn) &&
        sameText(storedLine.descriptionAr, line.descriptionAr) &&
        sameFigure(storedLine.qty, line.qty) &&
        sameFigure(storedLine.unitPrice, line.unitPrice) &&
        sameFigure(storedLine.discountPct, line.discountPct) &&
        sameFigure(storedLine.unitCost, line.unitCost)
      );
    });
  });
}

/** The stored draft as a save receipt: its revision and the ids of its rows. */
export function receiptOfStored(stored: StoredDraft) {
  return {
    revision: stored.revision,
    sections: stored.sections.map((section) => ({
      id: section.id,
      lineIds: section.lines.map((line) => line.id),
    })),
  };
}
