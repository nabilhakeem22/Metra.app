import { Lock } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/format/money';

export async function FinancialsTab({
  contractedTotal,
  advancePct,
  retentionPct,
}: {
  contractedTotal: string;
  advancePct: string;
  retentionPct: string;
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
        <Stat label={t('advance')} value={`${advancePct}%`} />
        <Stat label={t('retention')} value={`${retentionPct}%`} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Locked label={t('jobCost')} />
        <Locked label={t('margin')} />
      </div>
      <p className="text-sm text-muted-foreground">{t('lockedBody')}</p>
    </div>
  );
}
