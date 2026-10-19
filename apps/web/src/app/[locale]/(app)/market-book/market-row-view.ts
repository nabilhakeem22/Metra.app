// A market row as the browser receives it: exactly what the table, the drawer's
// header and the add form show, and no more. The 13-month series stays on the
// server; the sparkline travels as its finished geometry. Each row's props are
// serialised into the page, so every field here is paid for on every render.
// Pure; the server page builds it from the query's MarketItemRow.
import type { MarketItemRow } from '@/lib/market-book/types';
import { sparklineGeometry, type SparklineGeometry } from './sparkline-geometry';

export const SPARKLINE = { width: 96, height: 24 } as const;

export interface MarketRowView
  extends Pick<
    MarketItemRow,
    'id' | 'key' | 'categoryKey' | 'nameAr' | 'nameEn' | 'specAr' | 'specEn' | 'unit' | 'unitLabelAr' | 'basisNoteAr' | 'status' | 'momPct' | 'ytdPct' | 'linkedCostItem'
  > {
  /** The newest month; a null price is a suspended month. */
  latest: { month: string; price: string | null } | null;
  /** The newest priced month the row shows: the cost an add saves, as far as the row can tell. */
  latestPriced: { month: string; price: string } | null;
  trend: SparklineGeometry;
}

export function marketRowView(row: MarketItemRow): MarketRowView {
  const { series, latest, yoyPct: _yoyPct, ...shown } = row;
  const priced = [...series].reverse().find((point) => point.status === 'priced' && point.price !== null);
  return {
    ...shown,
    latest: latest && { month: latest.month, price: latest.status === 'priced' ? latest.price : null },
    latestPriced: priced ? { month: priced.month, price: priced.price as string } : null,
    trend: sparklineGeometry(series, SPARKLINE.width, SPARKLINE.height),
  };
}
