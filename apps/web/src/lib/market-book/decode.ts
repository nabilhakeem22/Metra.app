// The market reads' JSON (./effective-sql.ts, ./page-sql.ts, ./item-sql.ts) as
// typed rows: positional arrays, so a 100-item page travels as one compact
// value and costs the Worker one JSON.parse. Pure.
import type { MarketItemStatus, MarketUnit } from '@metra/db';
import { marketChanges } from './change';
import type { MarketBulletinSummary, MarketCategory, MarketItemRow, MarketPoint } from './types';

export type PointTuple = [month: string, status: MarketPoint['status'], price: string | null, bulletinMonth: string, page: number];

export type ItemTuple = [
  id: string, key: string, categoryKey: string, nameAr: string, nameEn: string, specAr: string | null, specEn: string | null,
  unit: MarketUnit, unitLabelAr: string, basisNoteAr: string | null, status: MarketItemStatus,
  linkedId: string | null, linkedCode: string | null, pricedMonth: string | null, pricedPrice: string | null,
  seededNameAr: string | null, seededNameEn: string | null, points: PointTuple[],
];

export type BulletinTuple = [periodMonth: string, publishedAt: string, fromDay: number, toDay: number, regionKey: string];

export type CategoryTuple = [key: string, nameAr: string, nameEn: string, parentKey: string | null, itemCount: number];

export function decodePoint([month, status, price, bulletinMonth, sourcePage]: PointTuple): MarketPoint {
  return { month, status, price, bulletinMonth, sourcePage };
}

/** Every point the read sent for the item, ascending. */
export function itemPoints(tuple: ItemTuple): MarketPoint[] {
  return tuple[17].map(decodePoint);
}

/** An item row with `series` (ascending, at most 13 months) and the changes of its newest month. */
export function decodeItem(tuple: ItemTuple, series: MarketPoint[]): MarketItemRow {
  const [id, key, categoryKey, nameAr, nameEn, specAr, specEn, unit, unitLabelAr, basisNoteAr, status, linkedId, linkedCode,
    pricedMonth, pricedPrice, seededNameAr, seededNameEn] = tuple;
  return {
    id, key, categoryKey, nameAr, nameEn, specAr, specEn, unit, unitLabelAr, basisNoteAr, status,
    latest: series.at(-1) ?? null,
    series,
    ...marketChanges(series),
    latestPriced: pricedMonth !== null && pricedPrice !== null ? { month: pricedMonth, price: pricedPrice } : null,
    seededNames: seededNameAr !== null && seededNameEn !== null ? { nameAr: seededNameAr, nameEn: seededNameEn } : null,
    linkedCostItem: linkedId !== null && linkedCode !== null ? { id: linkedId, code: linkedCode } : null,
  };
}

export function decodeBulletin(tuple: BulletinTuple | null): MarketBulletinSummary | null {
  if (tuple === null) return null;
  const [periodMonth, publishedAt, collectionFromDay, collectionToDay, regionKey] = tuple;
  return { periodMonth, publishedAt, collectionFromDay, collectionToDay, regionKey };
}

export function decodeCategory([key, nameAr, nameEn, parentKey, itemCount]: CategoryTuple): MarketCategory {
  return { key, nameAr, nameEn, parentKey, itemCount };
}
