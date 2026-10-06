'use client';

import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/status-chip';
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
// A PURE leaf, not the queries barrel: this is a 'use client' module and the
// derivation it needs is one function over two fields.
import { VARIATION_STATUS_TONE } from '@/lib/ui/record-status-tones';
import { variationStatusKey } from '@/lib/variations/status-label';
import type {
  BaselineLine,
  ContractAction,
  DraftVoLine,
} from './contract-vo-types';
import { VariationCreateForm } from './variation-create-form';

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
        <p className="text-body text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center">
        {canOpenNew && (
          <Button variant="secondary" size="sm" className="ms-auto" onClick={() => setCreating((v) => !v)}>
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
          <CardContent className="py-6 text-center text-body text-muted-foreground">
            {tv('empty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-body">
              <tbody>
                {variations.map((v) => {
                  const statusKey = variationStatusKey(v);
                  return (
                  <tr key={v.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-caption" dir="ltr">
                      {formatDocNumber('VO', v.number, docYear(null, v.createdAt))}
                    </td>
                    <td className="px-4 py-2">
                      {pickLocale({ nameAr: v.titleAr, nameEn: v.titleEn }, 'name', locale).value}
                    </td>
                    <td className="px-4 py-2">
                      <StatusChip
                        tone={VARIATION_STATUS_TONE[statusKey]}
                        label={tv(`status.${statusKey}`)}
                      />
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">
                      {m(v.netDelta)}
                    </td>
                    <td className="px-4 py-2 text-end">
                      {canPriceVariation && v.status === 'draft' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => act(() => internalApproveVariation(v.id))}
                        >
                          {tv('internalApprove')}
                        </Button>
                      )}
                      {canPriceVariation && v.status === 'internal_approved' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => act(() => issueVariation(v.id))}
                        >
                          {tv('issue')}
                        </Button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
