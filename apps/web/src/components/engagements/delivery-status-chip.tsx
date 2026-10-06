import { useLocale, useTranslations } from 'next-intl';
import { StatusChip } from '@/components/ui/status-chip';
import { deliveryStatusTone, type DeliveryStatus } from '@/lib/engagements/delivery-status';
import { formatNumber } from '@/lib/format/number';

// NOT 'use client': the dashboard panel (a server component), the deliveries
// list and the delivery header (client components) all render it, and
// `useTranslations` works in each. One status, one chip, three surfaces.

function useWaitedFor(status: DeliveryStatus): string | undefined {
  const t = useTranslations('engagements.age');
  const locale = useLocale();
  if (status.kind !== 'waitingClient' && status.kind !== 'stalled') return undefined;
  if (status.days === 0) return t('today');
  // The count drives the plural; the DISPLAYED number is pre-formatted so it
  // stays in Latin digits under the bare `ar-EG` locale (lib/format/number.ts).
  return t('sinceDays', { count: status.days, n: formatNumber(status.days, locale) });
}

export function DeliveryStatusChip({ status }: { status: DeliveryStatus }) {
  const t = useTranslations('engagements.status');
  const detail = useWaitedFor(status);
  return (
    <StatusChip tone={deliveryStatusTone(status)} label={t(status.kind)} detail={detail} />
  );
}
