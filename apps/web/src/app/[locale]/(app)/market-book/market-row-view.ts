// A market row as the browser receives it: exactly what the table, the drawer's
// header and the add form show, and no more. The 13-month series stays on the
// server; the sparkline travels as its finished geometry. Each row's props are
// serialised into the page, so every field here is paid for on every render.
// Pure; the server page builds it from the query's MarketItemRow.
import { MARKET_WINDOW_MONTHS, shiftMonth } from '@/lib/market-book/change';
import type { MarketItemRow } from '@/lib/market-book/types';
import { sparklineGeometry, type SparklineGeometry } from './sparkline-geometry';

export const SPARKLINE = { width: 96, height: 24 } as const;

export interface MarketRowView
  extends Pick<
    MarketItemRow,
    | 'id' | 'key' | 'categoryKey' | 'nameAr' | 'nameEn' | 'specAr' | 'specEn' | 'unit' | 'unitLabelAr' | 'basisNoteAr' | 'status'
    | 'momPct' | 'ytdPct' | 'latestPriced' | 'seededNames' | 'linkedCostItem'
  > {
  /** The newest month; a null price is a suspended month. */
  latest: { month: string; price: string | null } | null;
  /** The cost an add saves (`latestPriced`) is from before the row's window: the add form says so. */
  latestPricedIsOld: boolean;
  trend: SparklineGeometry;
}

/** `windowEnd` is the newest published bulletin's month, where every row's window ends. */
export function marketRowView(row: MarketItemRow, windowEnd: string): MarketRowView {
  const { series, latest, yoyPct: _yoyPct, ...shown } = row;
  return {
    ...shown,
    latest: latest && { month: latest.month, price: latest.status === 'priced' ? latest.price : null },
    latestPricedIsOld: row.latestPriced !== null && row.latestPriced.month < shiftMonth(windowEnd, -MARKET_WINDOW_MONTHS),
    trend: sparklineGeometry(series, windowEnd, SPARKLINE.width, SPARKLINE.height),
  };
}
