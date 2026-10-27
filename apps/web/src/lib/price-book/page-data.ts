import 'server-only';
import type { OrgContext } from '@/lib/db/context';
import { readMarketColumn } from '@/lib/market-book/price-refs';
import type { PriceBookMarketColumn } from '@/lib/market-book/types';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { listSections } from '@/lib/sections/queries';
import type { PriceBookView } from './page-params';
import { listPriceBookPage, type PriceBookPage } from './page-query';

// Everything the price book page hands its client component, read on the
// server. These props ARE what the page serializes into its RSC payload and
// renders into its HTML, so a figure not read here can reach neither.

export interface PriceBookSectionOption {
  id: string;
  key: string | null;
  nameEn: string | null;
  nameAr: string | null;
}

export interface PriceBookPageProps {
  book: PriceBookPage;
  market: PriceBookMarketColumn;
  sections: PriceBookSectionOption[];
  /** owner/admin get CRUA; PM/accountant are read-only. */
  canManage: boolean;
  /** resolveSeeMargin: when false no unit cost and no market variance is read at all. */
  showsCost: boolean;
}

/**
 * The page's props, or null for a role without price_book read
 * (site_engineer, client, viewer), which the page answers with a 404. A
 * reader who may not see margin (resolveSeeMargin, the BOQ template's rule)
 * gets the book without its unit costs.
 */
export async function loadPriceBookPage(ctx: OrgContext, view: PriceBookView, locale: string): Promise<PriceBookPageProps | null> {
  if (!can(ctx.role, 'price_book', 'read')) return null;
  const [showsCost, sectionRows] = await Promise.all([resolveSeeMargin(ctx), listSections(ctx)]);
  const book = await listPriceBookPage(ctx, view, locale, showsCost);
  // The Market column of this page's items only (at most a page of them).
  const market = await readMarketColumn(ctx, book.rows);
  const sections = sectionRows.map(({ id, key, nameEn, nameAr }) => ({ id, key, nameEn, nameAr }));
  return { book, market, sections, canManage: can(ctx.role, 'price_book', 'create'), showsCost };
}
