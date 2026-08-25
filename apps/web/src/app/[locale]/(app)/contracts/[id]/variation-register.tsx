'use client';

import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from '@/i18n/routing';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import {
  createVariationDraft,
  internalApproveVariation,
  issueVariation,
  saveVariationDraft,
} from '@/lib/variations/actions';
import type { VariationListRow } from '@/lib/variations/queries';
import type {
  BaselineLine,
  ContractAction,
  DraftVoLine,
} from './contract-vo-types';
import { VariationCreateForm } from './variation-create-form';

const VO_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  internal_approved: 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]',
  issued: 'bg-[color:var(--brand-tint)] text-[color:var(--brand-ink)]',
  approved: 'bg-[color:var(--success-tint)] text-[color:var(--success)]',
  rejected: 'bg-destructive/10 text-destructive',
};

export function VariationRegister({
  contractId,
  contractStatus,
  variations,
  baselineLines,
  canDraftVariation,
  canPriceVariation,
  pending,
  m,
  act,
}: {
  contractId: string;
  contractStatus: string;
  variations: VariationListRow[];
  baselineLines: BaselineLine[];
  canDraftVariation: boolean;
  canPriceVariation: boolean;
  pending: boolean;
  m: (v: string) => string;
  act: ContractAction;
}) {
  const tv = useTranslations('variations');
  const locale = useLocale();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<DraftVoLine[]>([]);
  const [localPending, startLocal] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canOpenNew =
    canDraftVariation && (contractStatus === 'issued' || contractStatus === 'signed');

  function addLine() {
    setLines((ls) => [
      ...ls,
      { contractLineId: '', descriptionEn: '', qty: '1', unit: 'lump_sum', unitPrice: '0', discountPct: '0' },
    ]);
  }

  function createAndSave() {
    setError(null);
    startLocal(async () => {
      const created = await createVariationDraft({
        contractId,
        titleEn: title,
        reasonEn: reason || null,
      });
      if (!created.ok || !created.data) {
        setError(created.error ?? 'generic');
        return;
      }
      if (lines.length) {
        const saved = await saveVariationDraft({
          id: created.data,
          lines: lines.map((l, i) => ({
            contractLineId: l.contractLineId || null,
            descriptionEn: l.descriptionEn || 'Variation line',
            qty: l.qty,
            unit: l.unit,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            sortOrder: i,
          })),
        });
        if (!saved.ok) {
          setError(saved.error ?? 'generic');
          return;
        }
      }
      setCreating(false);
      setTitle('');
      setReason('');
      setLines([]);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center">
        {canOpenNew && (
          <Button size="sm" className="ms-auto" onClick={() => setCreating((v) => !v)}>
            <Plus className="size-4" aria-hidden />
            {tv('create')}
          </Button>
        )}
      </div>

      {creating && (
        <VariationCreateForm
          title={title}
          onTitleChange={setTitle}
          reason={reason}
          onReasonChange={setReason}
          lines={lines}
          setLines={setLines}
          baselineLines={baselineLines}
          onAddLine={addLine}
          onSave={createAndSave}
          saving={localPending}
        />
      )}

      {variations.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {tv('empty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <tbody>
                {variations.map((v) => (
                  <tr key={v.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                      {formatDocNumber('VO', v.number, docYear(null, v.createdAt))}
                    </td>
                    <td className="px-4 py-2">
                      {pickLocale({ nameAr: v.titleAr, nameEn: v.titleEn }, 'name', locale).value}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${VO_STATUS_STYLE[v.status] ?? 'bg-muted'}`}>
                        {tv(`status.${v.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">
                      {m(v.netDelta)}
                    </td>
                    <td className="px-4 py-2 text-end">
                      {canPriceVariation && v.status === 'draft' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => act(() => internalApproveVariation(v.id))}
                        >
                          {tv('internalApprove')}
                        </Button>
                      )}
                      {canPriceVariation && v.status === 'internal_approved' && (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => act(() => issueVariation(v.id))}
                        >
                          {tv('issue')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
