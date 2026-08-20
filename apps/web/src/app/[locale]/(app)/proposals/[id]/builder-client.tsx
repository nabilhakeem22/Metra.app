'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { computeSection, computeTotals } from '@/lib/aggregates/proposal-totals';
import {
  deleteDraftProposal,
  saveProposalDraft,
  sendProposal,
} from '@/lib/proposals/actions';
import type { ProposalDetail } from '@/lib/proposals/queries';
import { BuilderSectionCard } from './builder-section-card';
import { BuilderToolbar } from './builder-toolbar';
import { BuilderTotalsPanel } from './builder-totals-panel';
import {
  move,
  previewLine,
  type CostItemOption,
  type LineState,
  type SectionState,
} from './builder-model';
import type { SectionOption } from './section-combobox';

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
  const te = useTranslations('errors');
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);

  const [discountPct, setDiscountPct] = useState(detail.discountPct);
  const [taxRate, setTaxRate] = useState(detail.taxRate);
  const [supervisionPct, setSupervisionPct] = useState(detail.supervisionPct);
  const [sections, setSections] = useState<SectionState[]>(
    detail.sections.map((s) => ({
      titleEn: s.titleEn ?? '',
      titleAr: s.titleAr ?? '',
      lines: s.lines.map((l) => ({
        id: l.id,
        costItemId: l.costItemId,
        descriptionEn: l.descriptionEn ?? '',
        descriptionAr: l.descriptionAr ?? '',
        qty: l.qty,
        unit: l.unit,
        unitCost: l.unitCost ?? '0',
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
      })),
    })),
  );

  const totals = useMemo(() => {
    const sectionTotals = sections.map((s) =>
      computeSection(s.lines.map(previewLine)),
    );
    const doc = computeTotals(sectionTotals, {
      discountPct: discountPct || '0',
      taxRate: taxRate || '0',
      supervisionPct: supervisionPct || '0',
    });
    return { sectionTotals, doc };
  }, [sections, discountPct, taxRate, supervisionPct]);

  function patchSection(si: number, patch: Partial<SectionState>) {
    setSections((s) => s.map((sec, i) => (i === si ? { ...sec, ...patch } : sec)));
  }
  function patchLine(si: number, li: number, patch: Partial<LineState>) {
    setSections((s) =>
      s.map((sec, i) =>
        i === si
          ? { ...sec, lines: sec.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) }
          : sec,
      ),
    );
  }
  function addSection() {
    setSections((s) => [...s, { titleEn: '', titleAr: '', lines: [] }]);
  }
  function removeSection(si: number) {
    setSections((s) => s.filter((_, i) => i !== si));
  }
  function addLine(si: number, ci?: CostItemOption) {
    const line: LineState = ci
      ? {
          id: null,
          costItemId: ci.id,
          descriptionEn: ci.nameEn ?? '',
          descriptionAr: ci.nameAr ?? '',
          qty: '1',
          unit: ci.unit,
          unitCost: ci.defaultUnitCost,
          unitPrice: ci.defaultUnitPrice,
          discountPct: '0',
        }
      : {
          id: null,
          costItemId: null,
          descriptionEn: '',
          descriptionAr: '',
          qty: '1',
          unit: 'sqm',
          unitCost: '0',
          unitPrice: '0',
          discountPct: '0',
        };
    patchSection(si, { lines: [...sections[si].lines, line] });
  }
  function removeLine(si: number, li: number) {
    patchSection(si, { lines: sections[si].lines.filter((_, j) => j !== li) });
  }

  function buildPayload() {
    return {
      id: detail.id,
      header: {
        discountPct: discountPct || '0',
        taxRate: taxRate || '0',
        supervisionPct: supervisionPct || '0',
      },
      sections: sections.map((s, si) => ({
        titleEn: s.titleEn || null,
        titleAr: s.titleAr || null,
        sortOrder: si,
        lines: s.lines.map((l, li) => ({
          // Round-trip the stable id so the server preserves each line's stored
          // cost (ids aren't secret; sent even when margin is hidden).
          id: l.id,
          costItemId: l.costItemId,
          descriptionEn: l.descriptionEn || null,
          descriptionAr: l.descriptionAr || null,
          qty: l.qty || '0',
          unit: l.unit as LineState['unit'],
          // Only send cost when the role may see it; otherwise the core keeps
          // the stored cost by line id (null -> preserved / defaulted).
          unitCost: seeMargin ? l.unitCost || '0' : null,
          unitPrice: l.unitPrice || '0',
          discountPct: l.discountPct || '0',
          sortOrder: li,
        })),
      })),
    };
  }

  function save(then?: () => void) {
    startTransition(async () => {
      const res = await saveProposalDraft(
        buildPayload() as Parameters<typeof saveProposalDraft>[0],
      );
      if (res.ok) {
        toast({ title: t('toast.saved') });
        then?.();
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  function onSend() {
    startTransition(async () => {
      const saved = await saveProposalDraft(
        buildPayload() as Parameters<typeof saveProposalDraft>[0],
      );
      if (!saved.ok) {
        toast({ title: resolveActionError(saved.error as ActionCode, te), variant: 'destructive' });
        return;
      }
      const res = await sendProposal(detail.id);
      if (res.ok && res.link) {
        setLink(res.link);
        toast({ title: t('toast.sent') });
      } else {
        toast({ title: resolveActionError(res.error as ActionCode, te), variant: 'destructive' });
      }
    });
  }

  async function onDelete() {
    const ok = await confirm({
      title: t('actions.delete'),
      description: t('builder.delete'),
      confirmLabel: t('actions.delete'),
      cancelLabel: t('create.cancel'),
      variant: 'destructive',
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteDraftProposal(detail.id);
      if (res.ok) {
        toast({ title: t('toast.deleted') });
        router.push('/proposals');
      } else {
        toast({ title: resolveActionError(res.error as ActionCode, te), variant: 'destructive' });
      }
    });
  }

  return (
    <div className="space-y-4">
      {dialog}

      {link && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-sm font-medium">{t('view.shareTitle')}:</span>
            <Input readOnly dir="ltr" value={link} className="max-w-md text-xs" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(link);
                toast({ title: t('toast.linkCopied') });
              }}
            >
              {t('view.copyLink')}
            </Button>
          </CardContent>
        </Card>
      )}

      {sections.map((sec, si) => (
        <BuilderSectionCard
          key={si}
          section={sec}
          sectionIndex={si}
          sectionTotal={totals.sectionTotals[si]}
          seeMargin={seeMargin}
          costItems={costItems}
          sectionLibrary={sectionLibrary}
          patchSection={patchSection}
          patchLine={patchLine}
          addLine={addLine}
          removeLine={removeLine}
          onMoveUp={() => setSections(move(sections, si, -1))}
          onMoveDown={() => setSections(move(sections, si, 1))}
          onRemoveSection={() => removeSection(si)}
        />
      ))}

      <Button variant="outline" onClick={addSection}>
        <Plus className="size-4" aria-hidden />
        {t('builder.addSection')}
      </Button>

      {/* Totals + margin panel */}
      <BuilderTotalsPanel
        discountPct={discountPct}
        onDiscountPctChange={setDiscountPct}
        taxRate={taxRate}
        onTaxRateChange={setTaxRate}
        supervisionPct={supervisionPct}
        onSupervisionPctChange={setSupervisionPct}
        doc={totals.doc}
        seeMargin={seeMargin}
      />

      <BuilderToolbar
        proposalId={detail.id}
        seeMargin={seeMargin}
        canSend={canSend}
        pending={pending}
        onDelete={onDelete}
        onSave={() => save()}
        onSend={onSend}
      />
    </div>
  );
}
