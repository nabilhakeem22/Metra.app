'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { VariationListRow } from '@/lib/variations/queries';
import type { BaselineLine, ContractAction } from './contract-vo-types';
import { useVariationCreate } from './use-variation-create';
import { VariationCreateForm } from './variation-create-form';
import { VariationTable } from './variation-table';

/** The contract's variation register: the new-VO form (when one may be drafted) over the list. */
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
  const create = useVariationCreate(contractId);
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
      {create.open && <VariationCreateForm create={create} baselineLines={baselineLines} />}
      <VariationTable
        variations={variations}
        canPriceVariation={canPriceVariation}
        pending={pending}
        m={m}
        act={act}
      />
    </div>
  );
}
