'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { ProposalDetail } from '@/lib/proposals/queries';
import { useBuilderActions } from './builder-actions';
import type { CostItemOption } from './builder-model';
import { BuilderSectionCard } from './builder-section-card';
import { BuilderShareLink } from './builder-share-link';
import { BuilderToolbar } from './builder-toolbar';
import { BuilderTotalsPanel } from './builder-totals-panel';
import type { SectionOption } from './section-combobox';
import { useProposalDraft } from './use-proposal-draft';

// The proposal builder — COMPOSITION. What the studio is editing lives in
// use-proposal-draft.ts; what a client signs is built by proposal-payload.ts
// (pure, tested); every server write and every toast is in builder-actions.ts.
export function ProposalBuilder({
  detail,
  canSend,
  seeMargin,
  costItems,
  sectionLibrary,
}: {
  detail: ProposalDetail;
  canSend: boolean;
  seeMargin: boolean;
  costItems: CostItemOption[];
  sectionLibrary: SectionOption[];
}) {
  const t = useTranslations('proposals');
  const { confirm, dialog } = useConfirm();
  const draft = useProposalDraft(detail);
  const actions = useBuilderActions({
    proposalId: detail.id,
    confirm,
    // Read at CALL time, not at render time: a save fired from the toolbar must
    // carry the edit the studio made a keystroke ago, not the draft as it stood
    // when this hook was last rendered.
    draftState: () => ({
      id: detail.id,
      discountPct: draft.discountPct,
      taxRate: draft.taxRate,
      supervisionPct: draft.supervisionPct,
      sections: draft.sections,
      seeMargin,
    }),
  });

  return (
    <div className="space-y-4">
      {dialog}

      {actions.link && <BuilderShareLink t={t} link={actions.link} />}

      {draft.sections.map((section, sectionIndex) => (
        <BuilderSectionCard
          key={sectionIndex}
          section={section}
          sectionIndex={sectionIndex}
          sectionTotal={draft.totals.sectionTotals[sectionIndex]}
          seeMargin={seeMargin}
          costItems={costItems}
          sectionLibrary={sectionLibrary}
          patchSection={draft.patchSection}
          patchLine={draft.patchLine}
          addLine={draft.addLine}
          removeLine={draft.removeLine}
          onMoveUp={() => draft.moveSection(sectionIndex, -1)}
          onMoveDown={() => draft.moveSection(sectionIndex, 1)}
          onRemoveSection={() => draft.removeSection(sectionIndex)}
        />
      ))}

      <Button variant="outline" onClick={draft.addSection}>
        <Plus className="size-4" aria-hidden />
        {t('builder.addSection')}
      </Button>

      {/* Totals + margin panel */}
      <BuilderTotalsPanel
        discountPct={draft.discountPct}
        onDiscountPctChange={draft.setDiscountPct}
        taxRate={draft.taxRate}
        onTaxRateChange={draft.setTaxRate}
        supervisionPct={draft.supervisionPct}
        onSupervisionPctChange={draft.setSupervisionPct}
        doc={draft.totals.doc}
        seeMargin={seeMargin}
      />

      <BuilderToolbar
        proposalId={detail.id}
        seeMargin={seeMargin}
        canSend={canSend}
        pending={actions.pending}
        onDelete={actions.onDelete}
        onSave={actions.save}
        onSend={actions.onSend}
      />
    </div>
  );
}
