'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRouter } from '@/i18n/routing';
import { saveContractDraft } from '@/lib/contracts/actions';
import type { ContractDetail } from '@/lib/contracts/queries';

/**
 * Draft-only header editor — wires the tested saveContractDraftCore so staff set
 * retention/advance/terms/dates/payment terms before issuing. Fields are frozen
 * once the contract leaves draft (server enforces `contract_not_draft`).
 */
export function ContractHeaderForm({ detail }: { detail: ContractDetail }) {
  const t = useTranslations('contracts');
  const th = useTranslations('contracts.header');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    signatureDate: detail.signatureDate ?? '',
    startDate: detail.startDate ?? '',
    endDate: detail.endDate ?? '',
    advancePct: detail.advancePct,
    retentionPct: detail.retentionPct,
    paymentTermsDays:
      detail.paymentTermsDays != null ? String(detail.paymentTermsDays) : '',
    defectsLiabilityDays:
      detail.defectsLiabilityDays != null ? String(detail.defectsLiabilityDays) : '',
    termsEn: detail.termsEn ?? '',
    termsAr: detail.termsAr ?? '',
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveContractDraft({
        id: detail.id,
        header: {
          signatureDate: form.signatureDate || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          advancePct: form.advancePct,
          retentionPct: form.retentionPct,
          paymentTermsDays: form.paymentTermsDays
            ? Number(form.paymentTermsDays)
            : null,
          defectsLiabilityDays: form.defectsLiabilityDays
            ? Number(form.defectsLiabilityDays)
            : null,
          termsEn: form.termsEn || null,
          termsAr: form.termsAr || null,
        },
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(res.error ?? 'generic');
      }
    });
  }

  const field = (
    key: keyof typeof form,
    label: string,
    type: 'text' | 'date' | 'number' = 'text',
  ) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type={type}
        dir={type === 'text' ? undefined : 'ltr'}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </label>
  );

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <h2 className="text-sm font-semibold">{t('contract')}</h2>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('advancePct', th('advancePct'), 'number')}
          {field('retentionPct', th('retentionPct'), 'number')}
          {field('signatureDate', th('signatureDate'), 'date')}
          {field('startDate', th('startDate'), 'date')}
          {field('endDate', th('endDate'), 'date')}
          {field('paymentTermsDays', th('paymentTermsDays'), 'number')}
          {field('defectsLiabilityDays', th('defectsLiabilityDays'), 'number')}
        </div>
        {field('termsEn', th('terms'))}
        {field('termsAr', th('terms'))}
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending} onClick={save}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('saveDraft')}
          </Button>
          {saved && <span className="text-sm text-emerald-600">{t('saved')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
