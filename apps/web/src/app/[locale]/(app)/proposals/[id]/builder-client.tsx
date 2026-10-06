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
import { useBoqModeActions, type BoqModeProps } from './use-boq-mode-actions';
import { useProposalDraft } from './use-proposal-draft';

export type { BoqModeProps };

// The proposal builder — COMPOSITION. What the studio is editing lives in
// use-proposal-draft.ts; what a client signs is built by proposal-payload.ts
// (pure, tested); every server write and every toast is in builder-actions.ts
// (quote) and use-boq-mode-actions.ts (BOQ). In BOQ mode the BOQ widgets
// (boq-mode-bar, send-as-boq-button) replace the quote's Delete, Send and share
// link.
//
// ONE BUSY FLAG. While anything is in flight (a save, Back, Send as BOQ) the
// whole builder sits inside a disabled <fieldset>: every editor, Save, Preview,
// Back and Send. An edit typed during a send would land AFTER the snapshot the
// BOQ was cut from.
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
  const actions = useBuilderActions({ proposalId: detail.id, confirm, draftState });
  const boq = useBoqModeActions({
    proposalId: detail.id,
    boqMode,
    draftState,
    totalBeforeVat: () => draft.totals.doc.total,
    confirm,
  });
  const busy = actions.pending || boq.busy;

  return (
    <div className="space-y-4">
      {dialog}

      <fieldset disabled={busy} aria-busy={busy} className="m-0 min-w-0 space-y-4 border-0 p-0">
        {boqMode && (
          <BoqModeBar onBack={boq.back} pending={boq.backPending} disabled={busy} />
        )}

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

        <Button variant="secondary" onClick={draft.addSection}>
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
          busy={busy}
          onDelete={actions.onDelete}
          onSave={actions.save}
          onSend={actions.onSend}
        >
          {boqMode?.canSend && (
            <SendAsBoqButton
              onSend={() => void boq.send()}
              pending={boq.sendPending}
              disabled={busy}
              lineCount={countSendable(draft.sections).lineCount}
            />
          )}
        </BuilderToolbar>
      </fieldset>
    </div>
  );
}
