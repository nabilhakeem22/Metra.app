'use client';

import { FileSignature, Loader2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Link, useRouter } from '@/i18n/routing';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { formatMoney } from '@/lib/format/money';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { generateContract } from '@/lib/contracts/actions';
import type { ContractListRow } from '@/lib/contracts/queries';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  issued: 'bg-blue-500/10 text-blue-600',
  signed: 'bg-emerald-500/10 text-emerald-600',
  terminated: 'bg-destructive/10 text-destructive',
};

interface Generatable {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  issueDate: string | null;
  createdAt: string;
}

export function ContractsClient({
  items,
  generatable,
  canManage,
}: {
  items: ContractListRow[];
  generatable: Generatable[];
  canManage: boolean;
}) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function generate(proposalId: string) {
    setError(null);
    startTransition(async () => {
      const res = await generateContract(proposalId);
      if (res.ok && res.data) {
        setPicking(false);
        router.push(`/contracts/${res.data}`);
      } else {
        setError(res.error ?? 'generic');
      }
    });
  }

  const generateButton = canManage && generatable.length > 0 && (
    <Button onClick={() => setPicking((v) => !v)}>
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
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {picking && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <p className="text-sm font-medium">{t('generateFromProposal')}</p>
            {generatable.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border-b py-2 last:border-0"
              >
                <span className="font-mono text-xs" dir="ltr">
                  {formatProposalNumber(p.number, proposalYear(p.issueDate, p.createdAt))}
                </span>
                <span className="flex-1 px-3 text-sm">
                  {pickLocale({ nameAr: p.titleAr, nameEn: p.titleEn }, 'name', locale).value}
                </span>
                <Button size="sm" disabled={pending} onClick={() => generate(p.id)}>
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : null}
                  {t('generate')}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
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
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-start font-medium">{t('number')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('client')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('project')}</th>
                    <th className="px-4 py-2 text-start font-medium">{t('status.draft')}</th>
                    <th className="px-4 py-2 text-end font-medium">{t('value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                        <Link href={`/contracts/${c.id}`} className="text-primary hover:underline">
                          {formatDocNumber('C', c.number, docYear(null, c.createdAt))}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {pickLocale({ nameAr: c.clientNameAr, nameEn: c.clientNameEn }, 'name', locale).value || '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {pickLocale({ nameAr: c.projectNameAr, nameEn: c.projectNameEn }, 'name', locale).value || '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[c.status] ?? 'bg-muted'}`}>
                          {t(`status.${c.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-end" dir="ltr">
                        {formatMoney(c.originalValue, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
