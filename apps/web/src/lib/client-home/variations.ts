import 'server-only';
// Public (no-session) client home, the CHANGE ORDERS awaiting the client's
// decision: `app_home_variations_by_token`, each order /v's own document, read
// through lib/share/sdf-call (NO withOrgContext, NO org GUCs: the token IS the
// auth). Only the `open` list is kept; the raw token is hashed here and never
// logged. The act is lib/client-home/code-acts.ts.
import { sql } from 'drizzle-orm';
import type { PublicContractLine } from '@/lib/contracts/public-types';
import { isRecord } from '@/lib/guards/is-record';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { publicVariationOf } from '@/lib/variations/public-shape';
import type { PublicVariation, VariationTokenDocument } from '@/lib/variations/public-types';
import { changeOrderLineOf, homeChangeOrderOf } from './change-order-shape';
import { optionalPageRead } from './optional-read';
import { getHomeByToken } from './read';
import type { HomeChangeOrder } from './types';

/** The orders the home can have decided NOW, newest first (at most 10), or null for a link that shows none. */
async function readOpenOrders(rawToken: string): Promise<PublicVariation[] | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const answer = await readSdfJson<unknown>(sql`select public.app_home_variations_by_token(${hashShareToken(token)}) as data`);
  if (!isRecord(answer) || !Array.isArray(answer.open)) return null;
  return (answer.open as VariationTokenDocument[]).map(publicVariationOf);
}

/**
 * The orders the page shows, read with the page while some are open. A read
 * that failed or was slow (./optional-read.ts) answers null: the section says
 * it could not show them, and no decision is offered on an unseen order.
 */
export async function readOpenChangeOrders(rawToken: string): Promise<HomeChangeOrder[] | null> {
  return optionalPageRead('client home change orders read failed:', readOpenOrders(rawToken).then((orders) => orders && orders.map(homeChangeOrderOf)));
}

/**
 * Whether the page of the home behind `rawToken` shows the order `variationId`
 * for a decision now: it is on the list, and the page reads the list. The page
 * goes by the home's count, which holds a SIGNED contract's orders only (the
 * SQL's money facts), so an order issued on a contract still awaiting signature
 * is on the list and not on the page. A failed list read throws: the caller decides.
 */
export async function homeShowsOpenChangeOrder(rawToken: string, variationId: string): Promise<boolean> {
  const open = await readOpenOrders(rawToken);
  if (open === null || !open.some((order) => order.id === variationId)) return false;
  const read = await getHomeByToken(rawToken);
  return read.status === 'ok' && (read.home.execution?.openVariationCount ?? 0) > 0;
}

/**
 * The lines of one order the home shows for a decision, in their order, when
 * the client asks for them. Null, uniformly, for an order decided or lapsed
 * since, another home's, or an id that is not one (no round trip).
 */
export async function getOpenChangeOrderLines(rawToken: string, variationId: unknown): Promise<PublicContractLine[] | null> {
  if (!isUuid(variationId)) return null;
  const id = variationId.toLowerCase();
  const order = (await readOpenOrders(rawToken))?.find((open) => open.id === id);
  return order ? [...order.lines].sort((first, second) => first.sort_order - second.sort_order).map(changeOrderLineOf) : null;
}
