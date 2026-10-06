import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import type { DeliveriesEmptyReason, DeliveriesEmptyState } from '@/lib/dashboard/setup-step';

const REASON_KEY: Record<DeliveriesEmptyReason, string> = {
  noClient: 'emptyNoClient',
  noProject: 'emptyNoProject',
  noDelivery: 'emptyNoDelivery',
  allClosed: 'emptyAllClosed',
};

/**
 * The deliveries panel with nothing in flight. It says WHY (no client yet, no
 * project yet, nothing started, or everything closed) and links to the missing
 * step when the role may take it, instead of one sentence for every case.
 */
export function DeliveriesPanelEmpty({ empty }: { empty: DeliveriesEmptyState }) {
  const t = useTranslations('dashboard');
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <p className="text-body text-[color:var(--text-muted)]">
        {t(`deliveries.${REASON_KEY[empty.reason]}`)}
      </p>
      {empty.cta && (
        <Button asChild>
          <Link href={empty.cta.href}>{t(empty.cta.messageKey)}</Link>
        </Button>
      )}
    </div>
  );
}
