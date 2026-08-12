'use client';

import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { SectionCombobox, type SectionOption } from './section-combobox';
import { addSectionLibraryEntry } from '@/lib/section-library/actions';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  coerceMoneyInput,
  computeLine,
  computeSection,
  computeTotals,
} from '@/lib/aggregates/proposal-totals';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import {
  deleteDraftProposal,
  saveProposalDraft,
  sendProposal,
} from '@/lib/proposals/actions';
import type { ProposalDetail } from '@/lib/proposals/queries';

interface CostItemOption {
  id: string;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  unit: string;
  defaultUnitCost: string;
  defaultUnitPrice: string;
}

interface LineState {
  id: string | null;
  costItemId: string | null;
  descriptionEn: string;
  descriptionAr: string;
  qty: string;
  unit: string;
  unitCost: string;
  unitPrice: string;
  discountPct: string;
}

// Live preview must match persistence: input the server would reject -> 0.
function previewLine(l: LineState) {
  return computeLine({
    qty: coerceMoneyInput(l.qty),
    unitCost: coerceMoneyInput(l.unitCost),
    unitPrice: coerceMoneyInput(l.unitPrice),
    discountPct: coerceMoneyInput(l.discountPct),
  });
}

interface SectionState {
  titleEn: string;
  titleAr: string;
  lines: LineState[];
}

const UNITS = ['sqm', 'linear_meter', 'pcs', 'lump_sum', 'day'];

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

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
  const th = useTranslations('hints.proposal');
  const te = useTranslations('errors');
  const locale = useLocale();
  const isAr = locale.startsWith('ar');
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

  const inp = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

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

      {sections.map((sec, si) => {
        const st = totals.sectionTotals[si];
        return (
          <Card key={si}>
            <CardContent className="space-y-3 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <SectionCombobox
                  className="min-w-40 flex-1"
                  locale={locale}
                  valueEn={sec.titleEn}
                  valueAr={sec.titleAr}
                  options={sectionLibrary}
                  placeholder={
                    isAr ? t('builder.sectionTitleAr') : t('builder.sectionTitleEn')
                  }
                  onChange={(patch) => patchSection(si, patch)}
                  onCreate={(name) => {
                    // Fire-and-forget: recording the title never blocks the build.
                    void addSectionLibraryEntry(name);
                  }}
                  aria-describedby={`sec-hint-${si}`}
                />
                <Input
                  dir={isAr ? 'ltr' : 'rtl'}
                  placeholder={
                    isAr ? t('builder.sectionTitleEn') : t('builder.sectionTitleAr')
                  }
                  value={isAr ? sec.titleEn : sec.titleAr}
                  onChange={(e) =>
                    patchSection(
                      si,
                      isAr
                        ? { titleEn: e.target.value }
                        : { titleAr: e.target.value },
                    )
                  }
                  className="min-w-40 flex-1"
                />
                <FieldHint id={`sec-hint-${si}`} hint={th('sectionTitle')} />
                <Button variant="ghost" size="icon" aria-label={t('builder.moveUp')} onClick={() => setSections(move(sections, si, -1))}>
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t('builder.moveDown')} onClick={() => setSections(move(sections, si, 1))}>
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t('builder.removeSection')} onClick={() => removeSection(si)}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="px-1 py-1 text-start font-medium">{t('builder.description')}</th>
                      <th className="px-1 py-1 font-medium">
                        <span className="inline-flex items-center">
                          {t('builder.qty')}
                          <FieldHint hint={th('lineQty')} />
                        </span>
                      </th>
                      <th className="px-1 py-1 font-medium">{t('builder.unit')}</th>
                      {seeMargin && (
                        <th className="px-1 py-1 font-medium">
                          <span className="inline-flex items-center">
                            {t('builder.unitCost')}
                            <FieldHint hint={th('lineUnitCost')} />
                          </span>
                        </th>
                      )}
                      <th className="px-1 py-1 font-medium">
                        <span className="inline-flex items-center">
                          {t('builder.unitPrice')}
                          <FieldHint hint={th('lineUnitPrice')} />
                        </span>
                      </th>
                      <th className="px-1 py-1 font-medium">
                        <span className="inline-flex items-center">
                          {t('builder.discount')}
                          <FieldHint hint={th('lineDiscountPct')} />
                        </span>
                      </th>
                      <th className="px-1 py-1 text-end font-medium">{t('builder.sectionSubtotal')}</th>
                      <th className="px-1 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {sec.lines.map((l, li) => {
                      const lt = previewLine(l);
                      return (
                        <tr key={li} className="border-t">
                          <td className="px-1 py-1">
                            <Input dir="ltr" value={l.descriptionEn} onChange={(e) => patchLine(si, li, { descriptionEn: e.target.value })} className={inp} />
                          </td>
                          <td className="px-1 py-1">
                            <Input dir="ltr" inputMode="decimal" value={l.qty} onChange={(e) => patchLine(si, li, { qty: e.target.value })} className={`${inp} w-16`} />
                          </td>
                          <td className="px-1 py-1">
                            <select value={l.unit} onChange={(e) => patchLine(si, li, { unit: e.target.value })} className={inp}>
                              {UNITS.map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </td>
                          {seeMargin && (
                            <td className="px-1 py-1">
                              <Input dir="ltr" inputMode="decimal" value={l.unitCost} onChange={(e) => patchLine(si, li, { unitCost: e.target.value })} className={`${inp} w-20`} />
                            </td>
                          )}
                          <td className="px-1 py-1">
                            <Input dir="ltr" inputMode="decimal" value={l.unitPrice} onChange={(e) => patchLine(si, li, { unitPrice: e.target.value })} className={`${inp} w-20`} />
                          </td>
                          <td className="px-1 py-1">
                            <Input dir="ltr" inputMode="decimal" value={l.discountPct} onChange={(e) => patchLine(si, li, { discountPct: e.target.value })} className={`${inp} w-14`} />
                          </td>
                          <td className="px-1 py-1 text-end" dir="ltr">{formatMoney(lt.lineTotal, locale)}</td>
                          <td className="px-1 py-1">
                            <Button variant="ghost" size="icon" aria-label={t('builder.removeLine')} onClick={() => removeLine(si, li)}>
                              <Trash2 className="size-4" aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => addLine(si)}>
                    <Plus className="size-4" aria-hidden />
                    {t('builder.addLine')}
                  </Button>
                  {costItems.length > 0 && (
                    <select
                      className={inp}
                      value=""
                      onChange={(e) => {
                        const ci = costItems.find((c) => c.id === e.target.value);
                        if (ci) addLine(si, ci);
                      }}
                    >
                      <option value="">{t('builder.fromPriceBook')}</option>
                      {costItems.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} · {pickLocale({ nameAr: c.nameAr, nameEn: c.nameEn }, 'name', locale).value}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <span className="text-sm font-medium" dir="ltr">
                  {t('builder.sectionSubtotal')}: {formatMoney(st.sectionSubtotal, locale)}
                </span>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Button variant="outline" onClick={addSection}>
        <Plus className="size-4" aria-hidden />
        {t('builder.addSection')}
      </Button>

      {/* Totals + margin panel */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm">
              {t('builder.discountPct')}
              <FieldHint hint={th('discountPct')} />
              <Input dir="ltr" inputMode="decimal" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} className={`${inp} w-20`} />
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              {t('builder.taxRate')}
              <FieldHint hint={th('taxRate')} />
              <Input dir="ltr" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={`${inp} w-20`} />
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              {t('builder.supervisionPct')}
              <FieldHint hint={th('supervisionPct')} />
              <Input dir="ltr" inputMode="decimal" value={supervisionPct} onChange={(e) => setSupervisionPct(e.target.value)} className={`${inp} w-20`} />
            </label>
          </div>
          <div className="ms-auto max-w-xs space-y-1 text-sm" dir="ltr">
            <Row label={t('builder.subtotal')} value={formatMoney(totals.doc.subtotal, locale)} />
            <Row label={t('builder.docDiscount')} value={formatMoney(totals.doc.discountAmount, locale)} />
            <Row label={t('builder.tax')} value={formatMoney(totals.doc.taxAmount, locale)} />
            <Row label={t('builder.supervision')} value={formatMoney(totals.doc.supervisionAmount, locale)} />
            <Row label={t('builder.total')} value={formatMoney(totals.doc.total, locale)} bold />
            {seeMargin ? (
              <>
                <Row label={t('builder.cost')} value={formatMoney(totals.doc.totalCost, locale)} />
                <Row label={t('builder.margin')} value={formatMoney(totals.doc.totalMargin, locale)} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t('builder.marginHidden')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onDelete} disabled={pending}>
          <Trash2 className="size-4" aria-hidden />
          {t('builder.delete')}
        </Button>
        <Button variant="outline" onClick={() => save()} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('builder.save')}
        </Button>
        {canSend && (
          <Button onClick={onSend} disabled={pending}>
            <Send className="size-4" aria-hidden />
            {t('builder.send')}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
