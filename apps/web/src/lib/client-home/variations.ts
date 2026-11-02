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

/** How many open orders the home lists: the SQL's own cap. */
const OPEN_ORDERS_LISTED = 10;

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
 * Whether the page of the home behind `rawToken` shows `variation`, known to be
 * open, for a decision now. The page goes by the home's count, which holds a
 * SIGNED contract's orders only (the SQL's money facts), so an order on a
 * contract still awaiting signature is not on the page; and the home stands on
 * one contract, so an order of an older one is not either. Up to the list's cap
 * the count says it all; past it, only the list can say (one more read). A home
 * read that failed is false, logged by its reader; a failed list read throws:
 * the caller decides.
 */
export async function homeShowsOpenChangeOrder(rawToken: string, variation: Pick<PublicVariation, 'id' | 'contract_number'>): Promise<boolean> {
  const read = await getHomeByToken(rawToken);
  const execution = read.status === 'ok' ? read.home.execution : null;
  if (!execution || execution.openVariationCount === 0 || execution.contract?.number !== variation.contract_number) return false;
  if (execution.openVariationCount <= OPEN_ORDERS_LISTED) return true;
  return (await readOpenOrders(rawToken))?.some((order) => order.id === variation.id) ?? false;
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
