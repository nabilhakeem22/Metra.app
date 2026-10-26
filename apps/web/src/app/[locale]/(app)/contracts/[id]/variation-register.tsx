'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { VariationListRow } from '@/lib/variations/queries';
import type { ContractAction, VariationChargeRates } from './contract-vo-types';
import { useVariationCreate } from './use-variation-create';
import { VariationCreateForm } from './variation-create-form';
import { VariationTable } from './variation-table';

/**
 * The contract's variation register: the new-VO form (when one may be drafted)
 * over the list. `chargeRates` is set on an execution contract only: its orders
 * may add days, and each shows its charge (D4a).
 */
export function VariationRegister({
  contractId,
  contractStatus,
  chargeRates,
  variations,
  canDraftVariation,
  canPriceVariation,
  canDecideOnPaper,
  pending,
  m,
  act,
}: {
  contractId: string;
  contractStatus: string;
  chargeRates: VariationChargeRates | null;
  variations: VariationListRow[];
  canDraftVariation: boolean;
  canPriceVariation: boolean;
  canDecideOnPaper: boolean;
  pending: boolean;
  m: (v: string) => string;
  act: ContractAction;
}) {
  const tv = useTranslations('variations');
  const create = useVariationCreate(contractId, chargeRates !== null);
  const canOpenNew =
    canDraftVariation && (contractStatus === 'issued' || contractStatus === 'signed');

  return (
    <div className="space-y-4">
      <div className="flex items-center">
        {canOpenNew && (
          <Button variant="secondary" size="sm" className="ms-auto" onClick={create.toggle}>
            <Plus className="size-4" aria-hidden />
            {tv('create')}
          </Button>
        )}
      </div>
      {create.open && <VariationCreateForm create={create} contractId={contractId} />}
      <VariationTable
        variations={variations}
        chargeRates={chargeRates}
        canPriceVariation={canPriceVariation}
        canDecideOnPaper={canDecideOnPaper}
        pending={pending}
        m={m}
        act={act}
      />
    </div>
  );
}
