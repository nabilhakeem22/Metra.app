import 'server-only';
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { MAX_IMPORT_ROWS } from './parse';
import { existingCodesAmong } from './queries';

/** A cell longer than this is not looked up (no studio code is that long); the import itself still checks it. */
const MAX_CODE_LENGTH = 500;

/**
 * Which of an import sheet's codes the studio already has, for the wizard's
 * preview: the page holds one page of the book, not every code, so it asks.
 * Read-only; the import re-checks every row against the live codes anyway
 * (import-core.ts), so a preview that went stale meanwhile imports nothing twice.
 */
export async function findExistingCodesCore(
  ctx: OrgContext,
  codes: unknown,
): Promise<ActionResult & { data?: string[] }> {
  if (!can(ctx.role, 'price_book', 'create')) return err('forbidden');
  if (!Array.isArray(codes) || codes.length > MAX_IMPORT_ROWS) return err('malformed');
  if (!codes.every((code): code is string => typeof code === 'string')) return err('malformed');
  const lookedUp = [...new Set(codes.filter((code) => code !== '' && code.length <= MAX_CODE_LENGTH))];
  try {
    return { ok: true, data: await existingCodesAmong(ctx, lookedUp) };
  } catch (error) {
    return unexpectedFailure('price book import code lookup failed', error);
  }
}
