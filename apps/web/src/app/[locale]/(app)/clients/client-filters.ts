import type { ClientRow } from './types';

// WHICH CLIENTS THE LIST SHOWS. PURE and server-safe: no React, no db. It was a
// `useMemo` in a render body, which is business logic in a place nobody can call
// (R3) — "the list opens showing everything" is a product decision, and the search
// looking at name AND email is a promise made in the spec.

export type ClientStatusFilter = 'all' | 'active' | 'inactive';

export interface ClientFilter {
  query: string;
  /** 'all' is the resting state, so the list opens showing everything rather than
   *  a silently narrowed subset. */
  status: ClientStatusFilter;
  /** A city name, or 'all'. */
  city: string;
}

/** The CITIES present in the data, sorted for the locale reading them.
 *  Derived rather than configured: a firm's cities are whatever its clients
 *  are in. */
export function cityOptions(items: readonly ClientRow[], locale: string): string[] {
  const present = new Set(
    items.map((client) => client.city?.trim()).filter((city): city is string => !!city),
  );
  return [...present].sort((a, b) => a.localeCompare(b, locale));
}

function matchesStatus(client: ClientRow, status: ClientStatusFilter): boolean {
  if (status === 'active') return client.active;
  if (status === 'inactive') return !client.active;
  return true;
}

/** Spec: search by NAME (either language) and EMAIL. */
function matchesQuery(client: ClientRow, needle: string): boolean {
  if (needle === '') return true;
  const haystack =
    `${client.nameEn ?? ''} ${client.nameAr ?? ''} ${client.email ?? ''}`.toLowerCase();
  return haystack.includes(needle);
}

export function filterClients(
  items: readonly ClientRow[],
  filter: ClientFilter,
): ClientRow[] {
  const needle = filter.query.trim().toLowerCase();
  return items.filter(
    (client) =>
      matchesStatus(client, filter.status) &&
      (filter.city === 'all' || (client.city?.trim() ?? '') === filter.city) &&
      matchesQuery(client, needle),
  );
}
