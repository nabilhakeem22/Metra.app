'use client';

import { ChevronDown, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ContractScheduleCard } from '@/components/client-contract/schedule-card';
import { ContractSectionList } from '@/components/client-contract/section-list';
import { ContractTotalsCard } from '@/components/client-contract/totals-card';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import { cn } from '@/lib/utils';
import { loadHomeContractSectionLines, loadHomeContractSections } from '../contract-actions';
import { useHomeContract } from './use-home-contract';

const DOCUMENT_ID = 'home-contract-document';

/**
 * The full contract inside the Execution tab's contract section: closed with
 * the page (the tab's render reads nothing for it), opened on the client's
 * tap, then shown as /c shows it, through the SAME components: the sections
 * with their lines (more sections and a section's lines read when asked for),
 * the figures and the payment schedule. فصحى copy, Latin digits.
 */
export function ContractDocumentDisclosure({ token, contractId }: { token: string; contractId: string }) {
  const t = useTranslations('delivery.contract.document');
  const contract = useHomeContract(token, contractId);
  const { document, open, problem, pending } = contract;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={contract.toggle}
        disabled={pending}
        aria-expanded={open}
        aria-controls={document ? DOCUMENT_ID : undefined}
        className="inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-caption font-semibold outline-none focus-ring-brand hover:bg-muted disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
        )}
        {t(open ? 'hide' : 'show')}
      </button>
      {problem &&
        ('failure' in problem ? (
          <PortalFailureAlert failure={problem.failure} />
        ) : (
          <p role="alert" className="text-body text-destructive">
            {t(problem.own)}
          </p>
        ))}
      {document && (
        <div id={DOCUMENT_ID} hidden={!open} className="space-y-4">
          <ContractSectionList
            flat
            sections={document.sections}
            sectionCount={document.section_count}
            loadSections={(offset) => loadHomeContractSections(token, offset)}
            loadSectionLines={(sectionId, offset) => loadHomeContractSectionLines(token, sectionId, offset)}
          />
          <ContractTotalsCard flat contract={document} />
          <ContractScheduleCard flat contract={document} />
        </div>
      )}
    </div>
  );
}
