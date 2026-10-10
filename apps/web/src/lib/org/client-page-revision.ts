import 'server-only';
// The revision a Settings sheet saves against (Round C, C8 fix round F1). A
// short hash of the seven client-page values as they were loaded: the save is
// refused (`client_page_details_stale`) when the stored values no longer hash
// the same, so a sheet opened before a colleague's change cannot overwrite it
// unseen. Values, not `updated_at`, so an unrelated profile save (the name, the
// logo) does not make every open sheet stale.
import { createHash } from 'node:crypto';
import { CLIENT_PAGE_FIELDS, type ClientPageDetails } from './client-page-details';

/** `stored` may be a whole organizations row (or none yet): only the seven values count. */
export function clientPageRevision(stored: Partial<ClientPageDetails> | undefined): string {
  const values = CLIENT_PAGE_FIELDS.map((field) => stored?.[field] ?? null);
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 16);
}
