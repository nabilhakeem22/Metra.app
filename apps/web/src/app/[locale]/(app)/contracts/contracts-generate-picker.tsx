'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import { pickLocale } from '@/lib/i18n/pick-locale';

export interface Generatable {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  issueDate: string | null;
  createdAt: string;
}

/**
 * The "generate from a proposal" card: one row per proposal that can become a
 * contract, each with its own Generate button. The parent owns the open state,
 * the pending flag and the generate action.
 */
export function ContractsGeneratePicker({
  generatable,
  pending,
  locale,
  t,
  onGenerate,
}: {
  generatable: Generatable[];
  pending: boolean;
  locale: string;
  t: ReturnType<typeof useTranslations<'contracts'>>;
  onGenerate: (proposalId: string) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <p className="text-body font-medium">{t('generateFromProposal')}</p>
        {generatable.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between border-b py-2 last:border-0"
          >
            <span className="font-mono text-caption" dir="ltr">
              {formatProposalNumber(p.number, proposalYear(p.issueDate, p.createdAt))}
            </span>
            <span className="flex-1 px-3 text-body">
              {pickLocale({ nameAr: p.titleAr, nameEn: p.titleEn }, 'name', locale).value}
            </span>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => onGenerate(p.id)}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {t('generate')}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
