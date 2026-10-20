'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { formatMoney } from '@/lib/format/money';
import { issueContract, terminateContract } from '@/lib/contracts/actions';
import type { ContractPageDetail, ContractSectionsPage } from '@/lib/contracts/queries';
import type { ContractScheduleView } from '@/lib/contracts/schedule/queries';
import type { ContractBillingView } from '@/lib/execution/billing/view';
import type { VariationListRow } from '@/lib/variations/queries';
import { ContractOverview } from './contract-overview';
import { ContractTabStrip } from './contract-tab-strip';
import type { ContractAction } from './contract-vo-types';
import { PaymentsTab } from './payments-tab';
import type { BillingMay } from './request-row';
import { ScheduleTab } from './schedule-tab';
import { ShareLinkCard } from './share-link-card';
import type { ContractTab } from './tabs';
import { useContractBilling } from './use-contract-billing';
import { useKeptSectionLines } from './use-kept-section-lines';
import { useKeptSections } from './use-kept-sections';
import { VariationRegister } from './variation-register';

export function ContractDetailClient({
  detail,
  openingSections,
  variations,
  schedule,
  openingBilling,
  billingMay,
  tabs,
  openingTab,
  canSignOffline,
  canManage,
  canIssue,
  canDraftVariation,
  canPriceVariation,
}: {
  detail: ContractPageDetail;
  /** The first page of sections when the page opened on the overview; null on another tab. */
  openingSections: ContractSectionsPage | null;
  variations: VariationListRow[];
  /** The payment schedule of an execution contract; null on a proposal contract. */
  schedule: ContractScheduleView | null;
  /** The Payments tab's data when the page opened on it; null otherwise (read when shown). */
  openingBilling: ContractBillingView | null;
  billingMay: BillingMay;
  tabs: readonly ContractTab[];
  openingTab: ContractTab;
  /** Owner, admin or project manager: may record a paper signature (D5). */
  canSignOffline: boolean;
  canManage: boolean;
  canIssue: boolean;
  canDraftVariation: boolean;
  canPriceVariation: boolean;
}) {
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<ContractTab>(openingTab);
  const keptSections = useKeptSections(openingSections);
  const keptLines = useKeptSectionLines();
  const billing = useContractBilling(detail.id, openingBilling);
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
      {link && <ShareLinkCard link={link} />}

      <ContractTabStrip tabs={tabs} current={tab} onSelect={setTab} />

      {tab === 'overview' && (
        <ContractOverview
          detail={detail}
          keptSections={keptSections}
          keptLines={keptLines}
          canManage={canManage}
          canIssue={canIssue}
          canSignOffline={canSignOffline}
          pending={pending}
          m={m}
          onIssue={() => act(() => issueContract(detail.id))}
          onTerminate={() => act(() => terminateContract(detail.id))}
        />
      )}
      {tab === 'schedule' && schedule && (
        <ScheduleTab
          contractId={detail.id}
          status={detail.status}
          canManage={canManage}
          schedule={schedule}
          contract={detail}
          m={m}
        />
      )}
      {tab === 'payments' && <PaymentsTab billing={billing} may={billingMay} m={m} />}
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
