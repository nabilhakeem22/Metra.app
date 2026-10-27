import 'server-only';
// What the client home reads for one request: the chosen tab's data and
// nothing else (the Workers CPU budget, plan "Reads per view"). Each tab is one
// token SDF:
//   Execution  app_home_by_token (the money card embedded; never the design snapshot)
//   Design     app_delivery_by_token (at `execution`, the design record)
// ONE state reads a second: while the contract awaits the client's signature,
// the Execution tab shows the document open above the signing, so it reads
// app_home_contract_by_token with the page (H6.2, A2).
// With no tab the page opens on the delivery's current phase, and only the
// design snapshot can say which that is without a second call: so the design
// phase stays one call, as it was, and a delivery at `execution` reached by a
// link without a tab reads the home as well (two calls, as the construction
// page did). The links the studio hands out for the Execution tab name it.
// A LIGHT delivery (entry_phase 'execution') has no design phase, so it has no
// design tab: without a tab it opens the Execution tab, and a link to its
// design tab is sent there instead.
import { readSigningDocument } from '@/lib/client-home/contract';
import { getHomeByToken } from '@/lib/client-home/read';
import type { HomeTab } from '@/lib/client-home/tab';
import type { HomeAtExecution, HomeExecution, PortalHome } from '@/lib/client-home/types';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { getDeliveryByToken, type DeliveryReadResult } from '@/lib/engagements/public';

type HomeView =
  | { tab: 'design'; read: DeliveryReadResult }
  | { tab: 'execution'; home: HomeAtExecution; signingDocument: ContractDocument | null }
  | { tab: 'redirect'; to: HomeTab };

/** The document a page awaiting the client's signature shows open; in every other state none is read. */
async function signingDocumentOf(token: string, execution: HomeExecution): Promise<ContractDocument | null> {
  const { contract, location } = execution;
  return location.reason === 'sign_contract' && contract ? readSigningDocument(token, contract.id) : null;
}

/** The Execution tab's view of a home, or null when the delivery is not at execution. */
async function atExecution(token: string, home: PortalHome): Promise<HomeView | null> {
  const { execution } = home;
  if (!execution) return null;
  return { tab: 'execution', home: { ...home, execution }, signingDocument: await signingDocumentOf(token, execution) };
}

/** The design tab's view: today's page, or the design record once the delivery is at execution. */
async function designView(token: string): Promise<HomeView> {
  return { tab: 'design', read: await getDeliveryByToken(token) };
}

/**
 * The Execution tab when the home is at `execution`. A link that resolves to
 * nothing, or a read that failed, is the same notice the design tab gives,
 * without a second call; a delivery not at execution has no such tab and opens
 * its design tab instead.
 */
async function executionView(token: string): Promise<HomeView> {
  const read = await getHomeByToken(token);
  if (read.status !== 'ok') return { tab: 'design', read };
  return (await atExecution(token, read.home)) ?? designView(token);
}

export async function readHomeView(token: string, requested: HomeTab | null): Promise<HomeView> {
  if (requested === 'execution') return executionView(token);
  const read = await getDeliveryByToken(token);
  if (read.status === 'ok' && read.delivery.entryPhase === 'execution') {
    return requested === 'design' ? { tab: 'redirect', to: 'execution' } : executionView(token);
  }
  const inExecution = read.status === 'ok' && read.delivery.stageKey === 'construction';
  if (requested === 'design' || !inExecution) return { tab: 'design', read };
  const home = await getHomeByToken(token);
  return (home.status === 'ok' ? await atExecution(token, home.home) : null) ?? { tab: 'design', read };
}
