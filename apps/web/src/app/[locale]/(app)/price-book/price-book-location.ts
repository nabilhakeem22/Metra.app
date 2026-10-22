'use client';

import { readPriceBookView, type PriceBookView } from '@/lib/price-book/page-params';

/** The view the address bar names now, as the page would read it. */
export function locationView(): PriceBookView {
  const params = new URLSearchParams(window.location.search);
  return readPriceBookView(Object.fromEntries([...params.keys()].map((key) => [key, params.get(key) ?? undefined])));
}
