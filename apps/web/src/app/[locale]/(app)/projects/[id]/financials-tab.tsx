import { Lock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/format/money';
import { formatPercent } from '@/lib/format/number';

export async function FinancialsTab({
  contractedTotal,
  advancePct,
  retentionPct,
  contractCount,
}: {
  contractedTotal: string;
  advancePct: string | null;
  retentionPct: string | null;
  contractCount: number;
}) {
  const t = await getTranslations('projects.profile.financials');
  const locale = await getLocale();

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold" dir="ltr">
          {value}
        </p>
      </CardContent>
    </Card>
  );

  const Locked = ({ label }: { label: string }) => (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="size-4" aria-hidden />
          {t('lockedTitle')}
        </p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t('contracted')} value={formatMoney(contractedTotal, locale)} />
        {/* Derived from this project's committed contracts, value-weighted — not a
            typed-in default. Null means nothing is committed yet, which is a
            different fact from 0% and must not render as one. */}
        <Stat
          label={t('advance')}
          value={advancePct === null ? t('noContracts') : formatPercent(advancePct, locale)}
        />
        <Stat
          label={t('retention')}
          value={
            retentionPct === null ? t('noContracts') : formatPercent(retentionPct, locale)
          }
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Locked label={t('jobCost')} />
        <Locked label={t('margin')} />
      </div>
      {contractCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('derivedFrom', { n: contractCount })}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t('lockedBody')}</p>
    </div>
  );
}
