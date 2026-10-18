'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { BuilderSectionCard } from './builder-section-card';
import type { SectionOption } from './section-combobox';
import type { DraftFieldErrorsApi } from './use-draft-field-errors';
import type { ProposalDraftApi } from './use-proposal-draft';

/** Every section of the draft, in order, and the button that adds one. */
export function BuilderSections({
  draft,
  seeMargin,
  hasPriceBook,
  sectionLibrary,
  cells,
}: {
  draft: ProposalDraftApi;
  seeMargin: boolean;
  hasPriceBook: boolean;
  sectionLibrary: SectionOption[];
  cells: DraftFieldErrorsApi;
}) {
  const t = useTranslations('proposals');
  return (
    <>
      {draft.sections.map((section, sectionIndex) => (
        <BuilderSectionCard
          key={sectionIndex}
          section={section}
          sectionIndex={sectionIndex}
          sectionTotal={draft.totals.sectionTotals[sectionIndex]}
          seeMargin={seeMargin}
          hasPriceBook={hasPriceBook}
          sectionLibrary={sectionLibrary}
          patchSection={draft.patchSection}
          patchLine={draft.patchLine}
          addLine={draft.addLine}
          removeLine={draft.removeLine}
          onMoveUp={() => draft.moveSection(sectionIndex, -1)}
          onMoveDown={() => draft.moveSection(sectionIndex, 1)}
          onRemoveSection={() => draft.removeSection(sectionIndex)}
          cells={cells}
        />
      ))}

      <Button variant="secondary" onClick={draft.addSection}>
        <Plus className="size-4" aria-hidden />
        {t('builder.addSection')}
      </Button>
    </>
  );
}
