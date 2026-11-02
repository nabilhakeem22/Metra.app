'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { StatusChip } from '@/components/ui/status-chip';
import type { HomeChangeOrder } from '@/lib/client-home/types';
import { ChangeOrderCard } from './change-order-card';
import { ChangeOrderNotice } from './change-order-notice';
import type { KnownCodeChannel } from './use-client-code';
import type { DecideNotice } from './use-change-order-decision';
import type { StudioContactFacts } from './use-studio-whatsapp';

/** A decision's answer, kept with the order it was said about. */
interface SaidNotice {
  variationId: string;
  number: number;
  notice: DecideNotice;
}

/**
 * The Execution tab's CHANGE ORDERS awaiting the client's decision: each with
 * its figures and its decision. What a decision came to is said once, at the top
 * of the section, under the order's number, and stays after the page is read
 * again, even when that emptied the list. The orders could not be read: it says
 * so, and offers no decision on an unseen order. A lapsed order is the hero's
 * line, since only the studio can act on it. فصحى copy, Latin digits.
 */
export function ExecutionChangeOrders({
  token,
  orders,
  openCount,
  channel,
  studio,
  openOn,
  onChanged,
}: {
  token: string;
  /** The newest open orders, read with the page; null when none is open, or when their read failed. */
  orders: HomeChangeOrder[] | null;
  openCount: number;
  channel: KnownCodeChannel;
  studio: StudioContactFacts;
  /** The order whose decision opens on its code box (a code email's `?focus=variation:<id>`), or null. */
  openOn: string | null;
  onChanged: () => void;
}) {
  const t = useTranslations('delivery.changeOrders');
  const [said, setSaid] = useState<SaidNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // The card that was decided may be far down the list, or gone after the refresh: the answer must be seen.
  useEffect(() => {
    if (said) noticeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [said]);
  if (openCount === 0 && said === null) return null;
  const listed = orders ?? [];

  return (
    <section id="change-orders" aria-labelledby={openCount > 0 ? 'home-change-orders-title' : undefined} className="order-3 scroll-mt-16 space-y-3 rounded-panel border bg-background p-4 shadow-sm">
      {openCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="home-change-orders-title" className="text-body font-semibold">
            {t('title')}
          </h2>
          <StatusChip tone="yourMove" label={t('awaiting')} />
        </div>
      )}
      {said && (
        <div ref={noticeRef} className="scroll-mt-16">
          <ChangeOrderNotice key={said.variationId} notice={said.notice} number={said.number} studio={studio.name} />
        </div>
      )}
      {openCount > 0 && listed.length === 0 && <p className="rounded-item bg-muted/50 p-3 text-caption text-muted-foreground">{t('unavailable')}</p>}
      {listed.map((order) => (
        <ChangeOrderCard
          key={order.id}
          token={token}
          order={order}
          channel={channel}
          studio={studio}
          onNotice={(notice) => setSaid(notice && { variationId: order.id, number: order.number, notice })}
          onChanged={onChanged}
          typingFor={openOn}
        />
      ))}
      {listed.length > 0 && openCount > listed.length && (
        <p className="text-caption text-muted-foreground">{t('moreThanShown', { shown: listed.length, count: openCount })}</p>
      )}
    </section>
  );
}
