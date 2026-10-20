import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import type { ProjectCostSummary } from '@/lib/execution/cost-sheet/project';
import { formatMoney } from '@/lib/format/money';
import { formatPercent } from '@/lib/format/number';

/** Job cost and margin: hidden from a role without the cost sheet, else the execution contract's (none yet: null). */
export type ProjectCost = { visible: false } | { visible: true; summary: ProjectCostSummary | null };

export async function FinancialsTab({
  contractedTotal,
  advancePct,
  retentionPct,
  contractCount,
  cost,
}: {
  contractedTotal: string;
  advancePct: string | null;
  retentionPct: string | null;
  contractCount: number;
  cost: ProjectCost;
}) {
  const t = await getTranslations('projects.profile.financials');
  const locale = await getLocale();
  const m = (value: string) => formatMoney(value, locale);
  const summary = cost.visible ? cost.summary : null;
  // Why a cost card has no figure: not this role's, or no execution contract yet.
  const missing = cost.visible ? t('noExecutionContract') : t('notShown');

  // A figure is pinned LTR; a word (a status, "no contracts yet") follows the page.
  const Stat = ({ label, value, figure = true, detail }: { label: string; value: string; figure?: boolean; detail?: ReactNode }) => (
    <Card>
      <CardContent className="py-4">
        <p className="text-caption text-muted-foreground">{label}</p>
        <p className={`mt-1 ${figure ? 'text-heading font-semibold' : 'text-body text-muted-foreground'}`} dir={figure ? 'ltr' : undefined}>
          {value}
        </p>
        {detail && <p className="mt-1 text-caption text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
  const margin = summary?.projectedMargin;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t('contracted')} value={formatMoney(contractedTotal, locale)} />
        {/* Derived from this project's committed contracts, value-weighted — not a
            typed-in default. Null means nothing is committed yet, which is a
            different fact from 0% and must not render as one. */}
        <Stat
          label={t('advance')}
          value={advancePct === null ? t('noContracts') : formatPercent(advancePct, locale)}
          figure={advancePct !== null}
        />
        <Stat
          label={t('retention')}
          figure={retentionPct !== null}
          value={
            retentionPct === null ? t('noContracts') : formatPercent(retentionPct, locale)
          }
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {summary ? (
          <Stat
            label={t('jobCost')}
            value={m(summary.actualCost)}
            detail={
              <>
                {t('budget')} <span dir="ltr">{m(summary.budgetCost)}</span>
              </>
            }
          />
        ) : (
          <Stat label={t('jobCost')} value={missing} figure={false} />
        )}
        {margin ? (
          <Stat label={t('margin')} value={`${m(margin.value)}${margin.pct === null ? '' : ` (${formatPercent(margin.pct, locale)})`}`} />
        ) : (
          <Stat label={t('margin')} value={summary ? t('notShown') : missing} figure={false} />
        )}
      </div>
      {contractCount > 0 && (
        <p className="text-caption text-muted-foreground">
          {t('derivedFrom', { n: contractCount })}
        </p>
      )}
      {cost.visible && (
        <p className="text-body text-muted-foreground">
          {t('costBody')}{' '}
          {summary && (
            <Link href={`/contracts/${summary.contractId}?tab=cost_sheet`} className="text-foreground underline">
              {t('openCostSheet')}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
