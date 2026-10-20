import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/routing';
import type { ProjectCostSummary } from '@/lib/execution/cost-sheet/project';
import { formatMoney } from '@/lib/format/money';
import { formatPercent } from '@/lib/format/number';

/** Job cost and margin: hidden from a role without the cost sheet, else the execution contract's (none yet: null). */
export type ProjectCost = { visible: false } | { visible: true; summary: ProjectCostSummary | null };

// A figure is pinned LTR; a word (a status, "no contracts yet") follows the page.
function Stat({ label, value, figure = true, detail }: { label: string; value: string; figure?: boolean; detail?: ReactNode }) {
  return (
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
}

export async function FinancialsTab({
  contractedTotal,
  advancePct,
  retentionPct,
  contractCount,
  executionContractCount,
  cost,
}: {
  contractedTotal: string;
  advancePct: string | null;
  retentionPct: string | null;
  /** Committed PROPOSAL contracts: the two rates are theirs. */
  contractCount: number;
  executionContractCount: number;
  cost: ProjectCost;
}) {
  const t = await getTranslations('projects.profile.financials');
  const locale = await getLocale();
  const m = (value: string) => formatMoney(value, locale);
  const summary = cost.visible ? cost.summary : null;
  // Why a cost card has no figure: not this role's, or no execution contract yet.
  const missing = cost.visible ? t('noExecutionContract') : t('notShown');
  // An execution contract has no advance or retention terms (F4): on a project
  // with only those, the two cards would show 0.00% for terms that do not exist.
  const showRates = contractCount > 0 || executionContractCount === 0;
  const jobCost = summary?.cost;

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 gap-3 ${showRates ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <Stat label={t('contracted')} value={m(contractedTotal)} />
        {/* Derived from this project's committed proposal contracts, value-weighted:
            not a typed-in default. Null means nothing is committed yet, which is a
            different fact from 0% and must not render as one. */}
        {showRates && (
          <>
            <Stat
              label={t('advance')}
              value={advancePct === null ? t('noContracts') : formatPercent(advancePct, locale)}
              figure={advancePct !== null}
            />
            <Stat
              label={t('retention')}
              value={retentionPct === null ? t('noContracts') : formatPercent(retentionPct, locale)}
              figure={retentionPct !== null}
            />
          </>
        )}
      </div>
      {showRates && contractCount > 0 && <p className="text-caption text-muted-foreground">{t('derivedFrom', { n: contractCount })}</p>}
      {summary && !jobCost ? (
        // A role that may not see margin gets the execution contract's billing only (F10, S1).
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label={t('requested')} value={m(summary.billing.requested)} />
          <Stat label={t('paid')} value={m(summary.billing.paid)} />
          <Stat label={t('outstanding')} value={m(summary.billing.outstanding)} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {jobCost ? (
            <Stat
              label={t('jobCost')}
              value={m(jobCost.actualCost)}
              detail={
                <>
                  {t('budget')} <span dir="ltr">{m(jobCost.budgetCost)}</span>
                </>
              }
            />
          ) : (
            <Stat label={t('jobCost')} value={missing} figure={false} />
          )}
          {jobCost ? (
            <Stat
              label={t('margin')}
              value={`${m(jobCost.projectedMargin.value)}${jobCost.projectedMargin.pct === null ? '' : ` (${formatPercent(jobCost.projectedMargin.pct, locale)})`}`}
            />
          ) : (
            <Stat label={t('margin')} value={missing} figure={false} />
          )}
        </div>
      )}
      {cost.visible && (
        <p className="text-body text-muted-foreground">
          {summary && !jobCost ? t('costHidden') : t('costBody')}{' '}
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
