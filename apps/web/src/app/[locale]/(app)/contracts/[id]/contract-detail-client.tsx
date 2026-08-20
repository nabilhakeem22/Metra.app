'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from '@/i18n/routing';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { issueContract, terminateContract } from '@/lib/contracts/actions';
import type { ContractDetail } from '@/lib/contracts/queries';
import type { VariationListRow } from '@/lib/variations/queries';
import { ContractOverview } from './contract-overview';
import type { BaselineLine } from './contract-vo-types';
import { CONTRACT_TABS, type ContractTab } from './tabs';
import { VariationRegister } from './variation-register';

export function ContractDetailClient({
  detail,
  variations,
  canManage,
  canIssue,
  canDraftVariation,
  canPriceVariation,
}: {
  detail: ContractDetail;
  variations: VariationListRow[];
  canManage: boolean;
  canIssue: boolean;
  canDraftVariation: boolean;
  canPriceVariation: boolean;
}) {
  const t = useTranslations('contracts');
  const tv = useTranslations('variations');
  const locale = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<ContractTab>('overview');
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const m = (v: string) => formatMoney(v, locale);
  const baselineLines: BaselineLine[] = detail.sections.flatMap((s) =>
    s.lines.map((l) => ({
      id: l.id,
      label:
        pickLocale({ nameAr: l.descriptionAr, nameEn: l.descriptionEn }, 'name', locale)
          .value || l.id.slice(0, 8),
    })),
  );

  function act(fn: () => Promise<{ ok: boolean; error?: string; link?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.link) setLink(res.link);
        router.refresh();
      } else {
        setError(res.error ?? 'generic');
      }
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {link && (
        <Card>
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <span className="text-muted-foreground">{t('shareLink')}:</span>
            <code className="flex-1 truncate" dir="ltr">
              {link}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigator.clipboard?.writeText(link)}
            >
              {t('copyLink')}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 border-b">
        {CONTRACT_TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`border-b-2 px-3 py-2 text-sm ${
              tab === tb
                ? 'border-primary font-medium'
                : 'border-transparent text-muted-foreground'
            }`}
          >
            {tb === 'overview' ? t('contract') : tv('register')}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <ContractOverview
          detail={detail}
          canManage={canManage}
          canIssue={canIssue}
          pending={pending}
          m={m}
          onIssue={() => act(() => issueContract(detail.id))}
          onTerminate={() => act(() => terminateContract(detail.id))}
        />
      ) : (
        <VariationRegister
          contractId={detail.id}
          contractStatus={detail.status}
          variations={variations}
          baselineLines={baselineLines}
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
