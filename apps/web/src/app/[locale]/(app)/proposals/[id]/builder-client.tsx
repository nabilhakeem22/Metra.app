'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { countSendable } from '@/lib/boq-proposals/count';
import type { ProposalDetail } from '@/lib/proposals/queries';
import { BoqModeBar } from './boq-mode-bar';
import { useBuilderActions } from './builder-actions';
import type { CostItemOption } from './builder-model';
import { BuilderSectionCard } from './builder-section-card';
import { BuilderShareLink } from './builder-share-link';
import { BuilderToolbar } from './builder-toolbar';
import { BuilderTotalsPanel } from './builder-totals-panel';
import type { ProposalDraftState } from './proposal-payload';
import type { SectionOption } from './section-combobox';
import { SendAsBoqButton } from './send-as-boq-button';
import { useProposalDraft } from './use-proposal-draft';

/** Set for the delivery's BOQ working copy; null for a quote. */
export interface BoqModeProps {
  engagementId: string;
  clientCanOpenNow: boolean;
  canSend: boolean;
}

// The proposal builder — COMPOSITION. What the studio is editing lives in
// use-proposal-draft.ts; what a client signs is built by proposal-payload.ts
// (pure, tested); every server write and every toast is in builder-actions.ts.
// In BOQ mode the BOQ widgets (boq-mode-bar, send-as-boq-button) replace the
// quote's Delete, Send and share link.
export function ProposalBuilder({
  detail,
  boqMode,
  canSend,
  seeMargin,
  costItems,
  sectionLibrary,
}: {
  detail: ProposalDetail;
  boqMode: BoqModeProps | null;
  canSend: boolean;
  seeMargin: boolean;
  costItems: CostItemOption[];
  sectionLibrary: SectionOption[];
}) {
  const t = useTranslations('proposals');
  const { confirm, dialog } = useConfirm();
  const draft = useProposalDraft(detail);
  // A FUNCTION rather than a snapshot, so each consumer (the quote actions, the
  // BOQ bar and Send as BOQ) reads the draft when it DISPATCHES. It is still THIS
  // RENDER's draft: a handler that patches and saves in the same frame sends the
  // PRE-PATCH value, as main always did; type-then-click carries the keystroke.
  const draftState = (): ProposalDraftState => ({
    id: detail.id,
    discountPct: draft.discountPct,
    taxRate: draft.taxRate,
    supervisionPct: draft.supervisionPct,
    sections: draft.sections,
    seeMargin,
  });
  const actions = useBuilderActions({
    proposalId: detail.id,
    confirm,
    draftState,
  });

  return (
    <div className="space-y-4">
      {dialog}

      {boqMode && <BoqModeBar engagementId={boqMode.engagementId} draftState={draftState} />}

      {!boqMode && actions.link && <BuilderShareLink t={t} link={actions.link} />}

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
        mode={boqMode ? 'boq' : 'quote'}
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
        mode={boqMode ? 'boq' : 'quote'}
        proposalId={detail.id}
        seeMargin={seeMargin}
        canSend={canSend}
        pending={actions.pending}
        onDelete={actions.onDelete}
        onSave={actions.save}
        onSend={actions.onSend}
      >
        {boqMode?.canSend && (
          <SendAsBoqButton
            proposalId={detail.id}
            engagementId={boqMode.engagementId}
            clientCanOpenNow={boqMode.clientCanOpenNow}
            lineCount={countSendable(draft.sections).lineCount}
            draftState={draftState}
            totalBeforeVat={() => draft.totals.doc.total}
            confirm={confirm}
          />
        )}
      </BuilderToolbar>
    </div>
  );
}
