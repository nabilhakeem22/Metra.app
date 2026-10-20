'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from '@/i18n/routing';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { formatMoney } from '@/lib/format/money';
import { issueContract, terminateContract } from '@/lib/contracts/actions';
import type { ContractPageDetail } from '@/lib/contracts/queries';
import type { CostEntriesPage } from '@/lib/execution/costs/types';
import type { VariationListRow } from '@/lib/variations/queries';
import { ContractOverview } from './contract-overview';
import type { ContractAction } from './contract-vo-types';
import { CostsTab } from './costs-tab';
import type { ContractTab } from './tabs';
import { useKeptSectionLines } from './use-kept-section-lines';
import { VariationRegister } from './variation-register';

export function ContractDetailClient({
  detail,
  variations,
  costs,
  tabs,
  canCreateCosts,
  canUpdateCosts,
  canManage,
  canIssue,
  canDraftVariation,
  canPriceVariation,
}: {
  detail: ContractPageDetail;
  variations: VariationListRow[];
  /** The first page of an execution contract's costs; null when the Costs tab is not shown. */
  costs: CostEntriesPage | null;
  tabs: readonly ContractTab[];
  canCreateCosts: boolean;
  canUpdateCosts: boolean;
  canManage: boolean;
  canIssue: boolean;
  canDraftVariation: boolean;
  canPriceVariation: boolean;
}) {
  const t = useTranslations('contracts');
  const tv = useTranslations('variations');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<ContractTab>('overview');
  const keptLines = useKeptSectionLines();
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const m = (v: string) => formatMoney(v, locale);

  const act: ContractAction = (fn) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          if (res.link) setLink(res.link);
          router.refresh();
        } else {
          setError(describeFailure(res, te));
        }
      } catch (rejection) {
        setError(describeRejection(rejection, te));
      }
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-body text-destructive" role="alert">
          {error}
        </p>
      )}
      {link && (
        <Card>
          <CardContent className="flex items-center gap-2 py-3 text-body">
            <span className="text-muted-foreground">{t('shareLink')}:</span>
            <code className="flex-1 truncate" dir="ltr">
              {link}
            </code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigator.clipboard?.writeText(link)}
            >
              {t('copyLink')}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 border-b">
        {tabs.map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`border-b-2 px-3 py-2 text-body ${
              tab === tb
                ? 'border-primary font-medium'
                : 'border-transparent text-muted-foreground'
            }`}
          >
            {tb === 'overview' ? t('contract') : tb === 'costs' ? t('costs.tab') : tv('register')}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <ContractOverview
          detail={detail}
          keptLines={keptLines}
          canManage={canManage}
          canIssue={canIssue}
          pending={pending}
          m={m}
          onIssue={() => act(() => issueContract(detail.id))}
          onTerminate={() => act(() => terminateContract(detail.id))}
        />
      )}
      {tab === 'costs' && costs && (
        <CostsTab
          contractId={detail.id}
          sections={detail.sections}
          initial={costs}
          canCreate={canCreateCosts}
          canUpdate={canUpdateCosts}
          m={m}
        />
      )}
      {tab === 'variations' && (
        <VariationRegister
          contractId={detail.id}
          contractStatus={detail.status}
          variations={variations}
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
