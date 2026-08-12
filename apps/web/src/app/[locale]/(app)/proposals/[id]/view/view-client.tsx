'use client';

import { FileDown, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { AnimatedNumber } from '@/components/data/animated-number';
import { VarianceLadder, type LadderRow } from '@/components/data/variance-ladder';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { formatMoney } from '@/lib/format/money';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { expireProposal, supersedeProposal } from '@/lib/proposals/actions';
import type { ProposalDetail } from '@/lib/proposals/queries';

export function ProposalView({
  detail,
  seeMargin,
  canSupersede,
  canExpire,
}: {
  detail: ProposalDetail;
  seeMargin: boolean;
  canSupersede: boolean;
  canExpire: boolean;
}) {
  const t = useTranslations('proposals');
  const te = useTranslations('errors');
  const tv = useTranslations('variance');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const money = (v: string) => formatMoney(v, locale);
  const loc = (ar: string | null, en: string | null) =>
    pickLocale({ nameAr: ar, nameEn: en }, 'name', locale).value;

  // Real price-vs-cost per section (margin-gated). NEVER demo rows.
  const ladderRows: LadderRow[] | null = seeMargin
    ? detail.sections.map((s) => {
        const actual = Number(s.sectionCost ?? '0');
        const contracted = Number(s.sectionSubtotal);
        return { name: loc(s.titleAr, s.titleEn), actual, contracted, over: actual > contracted };
      })
    : null;
  const num0 = (n: number) =>
    formatNumber(n, locale, { maximumFractionDigits: 0 });

  function onSupersede() {
    startTransition(async () => {
      const res = await supersedeProposal(detail.id);
      if (res.ok && res.data) {
        toast({ title: t('toast.superseded') });
        router.push(`/proposals/${res.data}`);
      } else {
        toast({ title: resolveActionError(res.error as ActionCode, te), variant: 'destructive' });
      }
    });
  }
  function onExpire() {
    startTransition(async () => {
      const res = await expireProposal(detail.id);
      toast(
        res.ok
          ? { title: t('toast.expired') }
          : { title: resolveActionError(res.error as ActionCode, te), variant: 'destructive' },
      );
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {t(`statuses.${detail.status}`)}
        </span>
        <span className="text-sm text-muted-foreground">
          {t('view.version', { n: detail.version })}
        </span>
        <div className="ms-auto flex flex-wrap gap-2">
          <a href={`/api/pdf/proposals/${detail.id}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <FileDown className="size-4" aria-hidden />
              PDF
            </Button>
          </a>
          {canExpire && detail.status === 'sent' && (
            <Button variant="outline" size="sm" onClick={onExpire} disabled={pending}>
              {t('actions.expire')}
            </Button>
          )}
          {canSupersede && detail.status !== 'draft' && (
            <Button size="sm" onClick={onSupersede} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('actions.createV2')}
            </Button>
          )}
        </div>
      </div>

      {detail.sections.map((s) => (
        <Card key={s.id}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-sm font-semibold">{loc(s.titleAr, s.titleEn)}</h2>
              <span className="num text-sm">{money(s.sectionSubtotal)}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{loc(l.descriptionAr, l.descriptionEn)}</td>
                    <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                      {l.qty} {l.unit}
                    </td>
                    <td className="px-4 py-2 num text-end" dir="ltr">{money(l.unitPrice)}</td>
                    <td className="px-4 py-2 num text-end" dir="ltr">{money(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      {seeMargin && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <p className="text-xs font-medium text-muted-foreground">
              {tv('title')}
            </p>
            <VarianceLadder
              rows={ladderRows}
              emptyLabel={tv('empty')}
              formatPair={(r) => `${num0(r.actual)} / ${num0(r.contracted)}`}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="ms-auto max-w-xs space-y-1 py-4 text-sm" dir="ltr">
          <Row label={t('p.subtotal')} value={money(detail.subtotal)} />
          <Row label={t('p.discount')} value={money(detail.discountAmount)} />
          <Row label={t('p.tax')} value={money(detail.taxAmount)} />
          <div className="flex justify-between font-semibold">
            <span className="text-muted-foreground">{t('p.total')}</span>
            <AnimatedNumber
              value={Number(detail.total)}
              format={(n) => money(String(n))}
            />
          </div>
          {seeMargin && detail.totalMargin !== undefined && (
            <Row label={t('builder.margin')} value={money(detail.totalMargin)} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
