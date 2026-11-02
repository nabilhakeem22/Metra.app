'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ChangeOrderChargeRows } from '@/components/client-change-order/charge-rows';
import type { HomeChangeOrder } from '@/lib/client-home/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { ChangeOrderDecidePanel } from './change-order-decide-panel';
import { ChangeOrderLines } from './change-order-lines';
import type { KnownCodeChannel } from './use-client-code';
import type { DecideNotice } from './use-change-order-decision';
import type { StudioContactFacts } from './use-studio-whatsapp';

/**
 * One change order awaiting the client's decision: its number, title and reason,
 * what it costs and the time it adds, its items on a tap, and the decision. The
 * element id `variation-<id>` is what `?focus=variation:<id>` scrolls to. فصحى
 * copy, Latin digits; a long unbroken title or reason wraps inside the card.
 */
export function ChangeOrderCard({
  token,
  order,
  channel,
  studio,
  onNotice,
  onChanged,
  typingFor,
}: {
  token: string;
  order: HomeChangeOrder;
  channel: KnownCodeChannel;
  studio: StudioContactFacts;
  onNotice: (notice: DecideNotice | null) => void;
  onChanged: () => void;
  typingFor: string | null;
}) {
  const t = useTranslations('delivery.changeOrders');
  const locale = useLocale();
  const title = pickLocale({ textAr: order.title_ar, textEn: order.title_en }, 'text', locale).value;
  const reason = pickLocale({ textAr: order.reason_ar, textEn: order.reason_en }, 'text', locale).value;

  return (
    <article id={`variation-${order.id}`} aria-labelledby={`variation-title-${order.id}`} className="scroll-mt-16 space-y-3 rounded-item border p-3">
      <div className="space-y-1">
        <h3 id={`variation-title-${order.id}`} className="text-body font-semibold">
          {t('number', { number: bidiIsolate(String(order.number)) })}
        </h3>
        {title && <p className="text-body font-medium [overflow-wrap:anywhere]">{title}</p>}
        {reason && <p className="text-body text-muted-foreground [overflow-wrap:anywhere]">{reason}</p>}
      </div>
      <div className="space-y-1 text-body">
        <ChangeOrderChargeRows variation={order} standing="issued" m={(value) => formatMoney(value, locale)} />
      </div>
      <ChangeOrderLines token={token} variationId={order.id} lineCount={order.lineCount} />
      <ChangeOrderDecidePanel token={token} order={order} channel={channel} studio={studio} onNotice={onNotice} onChanged={onChanged} typingFor={typingFor} />
    </article>
  );
}
