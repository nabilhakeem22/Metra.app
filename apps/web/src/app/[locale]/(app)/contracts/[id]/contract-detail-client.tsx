'use client';

import { COST_ITEM_UNITS, type CostItemUnit } from '@metra/db';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRouter } from '@/i18n/routing';
import { formatMoney } from '@/lib/format/money';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import {
  issueContract,
  saveContractDraft,
  terminateContract,
} from '@/lib/contracts/actions';
import type { ContractDetail } from '@/lib/contracts/queries';
import {
  createVariationDraft,
  internalApproveVariation,
  issueVariation,
  saveVariationDraft,
} from '@/lib/variations/actions';
import type { VariationListRow } from '@/lib/variations/queries';
import { CONTRACT_TABS, type ContractTab } from './tabs';

const VO_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  internal_approved: 'bg-amber-500/10 text-amber-600',
  issued: 'bg-blue-500/10 text-blue-600',
  approved: 'bg-emerald-500/10 text-emerald-600',
  rejected: 'bg-destructive/10 text-destructive',
};

interface BaselineLine {
  id: string;
  label: string;
}

interface DraftVoLine {
  contractLineId: string;
  descriptionEn: string;
  qty: string;
  unit: CostItemUnit;
  unitPrice: string;
  discountPct: string;
}

export function ContractDetailClient({
  detail,
  variations,
  canManage,
  canIssue,
  canDraftVariation,
  canPriceVariation,
}: {
  detail: ContractDetail;
  variations: VariationListRow[];
  canManage: boolean;
  canIssue: boolean;
  canDraftVariation: boolean;
  canPriceVariation: boolean;
}) {
  const t = useTranslations('contracts');
  const tv = useTranslations('variations');
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<ContractTab>('overview');
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const m = (v: string) => formatMoney(v, locale);
  const baselineLines: BaselineLine[] = detail.sections.flatMap((s) =>
    s.lines.map((l) => ({
      id: l.id,
      label:
        pickLocale({ nameAr: l.descriptionAr, nameEn: l.descriptionEn }, 'name', locale)
          .value || l.id.slice(0, 8),
    })),
  );

  function act(fn: () => Promise<{ ok: boolean; error?: string; link?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.link) setLink(res.link);
        router.refresh();
      } else {
        setError(res.error ?? 'generic');
      }
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {link && (
        <Card>
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <span className="text-muted-foreground">{t('shareLink')}:</span>
            <code className="flex-1 truncate" dir="ltr">
              {link}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard?.writeText(link)}
            >
              {t('copyLink')}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 border-b">
        {CONTRACT_TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`border-b-2 px-3 py-2 text-sm ${
              tab === tb
                ? 'border-primary font-medium'
                : 'border-transparent text-muted-foreground'
            }`}
          >
            {tb === 'overview' ? t('contract') : tv('register')}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <Overview
          detail={detail}
          canManage={canManage}
          canIssue={canIssue}
          pending={pending}
          m={m}
          onIssue={() => act(() => issueContract(detail.id))}
          onTerminate={() => act(() => terminateContract(detail.id))}
        />
      ) : (
        <Variations
          contractId={detail.id}
          contractStatus={detail.status}
          variations={variations}
          baselineLines={baselineLines}
          canDraftVariation={canDraftVariation}
          canPriceVariation={canPriceVariation}
          pending={pending}
          m={m}
          act={act}
        />
      )}
    </div>
  );
}

function Overview({
  detail,
  canManage,
  canIssue,
  pending,
  m,
  onIssue,
  onTerminate,
}: {
  detail: ContractDetail;
  canManage: boolean;
  canIssue: boolean;
  pending: boolean;
  m: (v: string) => string;
  onIssue: () => void;
  onTerminate: () => void;
}) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const pick = (ar: string | null, en: string | null) =>
    pickLocale({ nameAr: ar, nameEn: en }, 'name', locale).value;
  const revised = detail.revisedValue !== detail.originalValue;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs`}>
            {t(`status.${detail.status}`)}
          </span>
          <span className="text-muted-foreground">
            {t('originalValue')}: <span dir="ltr">{m(detail.originalValue)}</span>
          </span>
          {revised && (
            <span className="text-muted-foreground">
              {t('revisedValue')}: <span dir="ltr">{m(detail.revisedValue)}</span>
            </span>
          )}
          <div className="ms-auto flex gap-2">
            {canIssue && detail.status === 'draft' && (
              <Button size="sm" disabled={pending} onClick={onIssue}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('issue')}
              </Button>
            )}
            {canIssue &&
              (detail.status === 'issued' || detail.status === 'signed') && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={onTerminate}
                >
                  {t('terminate')}
                </Button>
              )}
          </div>
        </CardContent>
      </Card>

      {canManage && detail.status === 'draft' && (
        <ContractHeaderForm detail={detail} />
      )}

      {detail.sections.map((s) => (
        <Card key={s.id}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-sm font-semibold">{pick(s.titleAr, s.titleEn)}</h2>
              <span className="text-sm" dir="ltr">
                {m(s.sectionSubtotal)}
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{pick(l.descriptionAr, l.descriptionEn)}</td>
                    <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                      {l.qty} {l.unit}
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">
                      {m(l.unitPrice)}
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">
                      {m(l.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Draft-only header editor — wires the tested saveContractDraftCore so staff set
 * retention/advance/terms/dates/payment terms before issuing. Fields are frozen
 * once the contract leaves draft (server enforces `contract_not_draft`).
 */
function ContractHeaderForm({ detail }: { detail: ContractDetail }) {
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

function Variations({
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
  act: (fn: () => Promise<{ ok: boolean; error?: string; link?: string }>) => void;
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
        <Card>
          <CardContent className="space-y-3 py-4">
            <Input placeholder={tv('title_')} value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input placeholder={tv('reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={l.contractLineId}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, contractLineId: e.target.value } : x)))
                    }
                  >
                    <option value="">{tv('netDelta')}</option>
                    {baselineLines.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="w-40"
                    placeholder="description"
                    value={l.descriptionEn}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, descriptionEn: e.target.value } : x)))
                    }
                  />
                  <Input
                    className="w-20"
                    dir="ltr"
                    value={l.qty}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                    }
                  />
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={l.unit}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit: e.target.value as CostItemUnit } : x)))
                    }
                  >
                    {COST_ITEM_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  <Input
                    className="w-24"
                    dir="ltr"
                    value={l.unitPrice}
                    onChange={(e) =>
                      setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    aria-label="remove"
                  >
                    <Trash2 className="size-4 text-muted-foreground" aria-hidden />
                  </button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={addLine}>
                <Plus className="size-4" aria-hidden />
              </Button>
            </div>
            <Button size="sm" disabled={localPending || !title.trim()} onClick={createAndSave}>
              {localPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {tv('saveDraft')}
            </Button>
          </CardContent>
        </Card>
      )}

      {variations.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {tv('empty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
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
