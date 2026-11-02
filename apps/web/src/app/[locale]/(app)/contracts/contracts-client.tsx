'use client';

import { FileSignature, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useRouter } from '@/i18n/routing';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { generateContract } from '@/lib/contracts/actions';
import type { ContractListRow } from '@/lib/contracts/queries';
import { ContractsGeneratePicker, type Generatable } from './contracts-generate-picker';
import { ContractsTable } from './contracts-table';

export function ContractsClient({
  items,
  generatable,
  canManage,
  pager,
}: {
  items: ContractListRow[];
  generatable: Generatable[];
  canManage: boolean;
  /** The register's pager, rendered by the server page under the table. */
  pager: ReactNode;
}) {
  const t = useTranslations('contracts');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function generate(proposalId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await generateContract(proposalId);
        if (res.ok && res.data) {
          setPicking(false);
          router.push(`/contracts/${res.data}`);
        } else {
          setError(describeFailure(res, te));
        }
      } catch (rejection) {
        setError(describeRejection(rejection, te));
      }
    });
  }

  const generateButton = canManage && generatable.length > 0 && (
    <Button variant="default" onClick={() => setPicking((v) => !v)}>
      <Plus className="size-4" aria-hidden />
      {t('generate')}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {generateButton && <div className="ms-auto">{generateButton}</div>}
      </div>

      {error && (
        <p className="text-body text-destructive" role="alert">
          {error}
        </p>
      )}

      {picking && (
        <ContractsGeneratePicker
          generatable={generatable}
          pending={pending}
          locale={locale}
          t={t}
          onGenerate={generate}
        />
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={<FileSignature className="size-6" aria-hidden />}
              title={t('title')}
              description={t('empty')}
              action={generateButton || undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <ContractsTable items={items} locale={locale} t={t} />
      )}
      {pager}
    </div>
  );
}
