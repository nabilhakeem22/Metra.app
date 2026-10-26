// The client home behind an execution contract: the delivery whose link /d
// shows the contract's Execution tab, and that link. `ensureClientHomeCore` is
// what the contract page's "Client page" control runs (and, from a later step,
// the contract's issue): it finds the home, creating a LIGHT delivery when the
// contract's BOQ has none behind it, and hands back the home's live link.
//
// THE HOME IS FOUND BY ITS CLIENT TOO (H3 security S2 and the index ruling): a
// delivery owns only its own client's BOQs (app_delivery_boqs), so a light
// delivery is the one of (project, client), the unique index
// design_engagements_one_light_per_project_client, and the BOQ's client is the
// one the light delivery is born for.
import { boqs, contracts, designEngagements, projects, type MetraDb } from '@metra/db';
import { and, eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { ActionError, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { DELIVERY_LINK_GATE, readLiveDeliveryLink } from '@/lib/engagements/share-reveal';
import { mintFirstDeliveryLink } from '@/lib/engagements/share';
import { can } from '@/lib/permissions/can';
import { isUuid } from '@/lib/uuid';
import type { ClientHomeLinkReason } from './types';

interface ClientHome {
  engagementId: string;
  /** The RAW token of the home's live link (never logged), or null with `linkReason`. */
  link: string | null;
  linkReason?: ClientHomeLinkReason;
}

/** The contract statuses a client home shows, and so the ones it is made for. */
const HOME_CONTRACT_STATUSES: ReadonlySet<string> = new Set(['issued', 'signed']);

/** The contract and the BOQ it was generated from: which delivery stands behind it, for which client. */
async function loadContractBoq(tx: MetraDb, contractId: string) {
  const contract = await requireInOrg(
    tx,
    contracts,
    contractId,
    { id: contracts.id, status: contracts.status, sourceBoqId: contracts.sourceBoqId },
    'record_not_found',
  );
  if (contract.sourceBoqId === null) fail('contract_not_execution');
  if (!HOME_CONTRACT_STATUSES.has(contract.status)) fail('contract_not_issued');
  return requireInOrg(
    tx,
    boqs,
    contract.sourceBoqId,
    { engagementId: boqs.engagementId, projectId: boqs.projectId, clientId: boqs.clientId },
    'boq_not_found',
  );
}

/** The light delivery of (project, client), or null. */
async function findLightHome(tx: MetraDb, projectId: string, clientId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: designEngagements.id })
    .from(designEngagements)
    .where(
      and(
        eq(designEngagements.projectId, projectId),
        eq(designEngagements.clientId, clientId),
        eq(designEngagements.entryPhase, 'execution'),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Insert the light delivery: born at `execution` with entry_phase
 * 'execution', titled with the project's names. A concurrent call that won the
 * (org, project, client) slot first leaves this insert with no row (ON
 * CONFLICT DO NOTHING on that unique index, after allocateNumber's per-org
 * lock has serialised both), and its row is the home.
 */
async function insertLightHome(tx: MetraDb, ctx: OrgContext, projectId: string, clientId: string): Promise<{ id: string; created: boolean }> {
  const project = await requireInOrg(tx, projects, projectId, { nameAr: projects.nameAr, nameEn: projects.nameEn }, 'record_not_found');
  const number = await allocateNumber(tx, ctx.orgId, 'design_engagement', 'design_engagements', 'number');
  const [row] = await tx
    .insert(designEngagements)
    .values({
      orgId: ctx.orgId,
      number,
      titleAr: project.nameAr,
      titleEn: project.nameEn,
      clientId,
      projectId,
      state: 'execution',
      entryPhase: 'execution',
    })
    .onConflictDoNothing({
      target: [designEngagements.orgId, designEngagements.projectId, designEngagements.clientId],
      where: sql`entry_phase = 'execution'`,
    })
    .returning({ id: designEngagements.id });
  if (row) return { id: row.id, created: true };
  const winner = await findLightHome(tx, projectId, clientId);
  if (winner === null) fail('client_home_unavailable');
  return { id: winner, created: false };
}

/**
 * The home must be at `execution` and show THIS contract (the one picker,
 * app_delivery_current_contract): an older contract of a project whose newer
 * BOQ stands in front of it has no home to send the client to.
 */
async function requireHomeShows(tx: MetraDb, engagementId: string, contractId: string): Promise<void> {
  const rows = (await tx.execute(
    sql`select de.state::text as state, public.app_delivery_current_contract(de.id, de.org_id) as contract_id
          from public.design_engagements de where de.id = ${engagementId}`,
  )) as unknown as Array<{ state: string; contract_id: string | null }>;
  const home = rows[0];
  if (home?.state !== 'execution' || home.contract_id !== contractId) fail('client_home_unavailable');
}

/** The link-reveal and first-mint refusals that leave the home without a link to hand back. */
const UNSHOWN_LINK: ReadonlySet<string> = new Set(['delivery_links_not_configured', 'delivery_link_unrecoverable']);

/**
 * The home's live link, re-derived; minted as its first link when it has none.
 * Only a role that may share delivery links sees one (DELIVERY_LINK_GATE).
 */
async function homeLink(tx: MetraDb, ctx: OrgContext, engagementId: string): Promise<Omit<ClientHome, 'engagementId'> & { minted: boolean }> {
  if (!can(ctx.role, DELIVERY_LINK_GATE.capability, DELIVERY_LINK_GATE.action)) {
    return { link: null, linkReason: 'not_allowed', minted: false };
  }
  try {
    return { link: (await readLiveDeliveryLink(tx, engagementId)).raw, minted: false };
  } catch (error) {
    if (!(error instanceof ActionError)) throw error;
    if (UNSHOWN_LINK.has(error.code)) return { link: null, linkReason: error.code as ClientHomeLinkReason, minted: false };
    if (error.code !== 'delivery_link_not_shared') throw error;
  }
  const minted = await mintFirstDeliveryLink(tx, engagementId);
  // A link that exists but has lapsed is not first: only a Replace from the delivery page renews it.
  return minted === null ? { link: null, linkReason: 'delivery_link_unrecoverable', minted: false } : { link: minted, minted: true };
}

/**
 * The client home of one BOQ contract, issued or signed. The home is the
 * delivery the BOQ was generated for, else the light delivery of the BOQ's
 * project and client, else a new light delivery. Its link is the live one,
 * minted first when it has none, for a role that may share links; otherwise
 * `link` is null and `linkReason` says why. Owner and admin
 * (`contracts_issue` approve), the interior flow. Audited on the delivery as an
 * `issue`, as the share cores are.
 */
export async function ensureClientHomeCore(
  ctx: OrgContext,
  input: { contractId: string },
): Promise<ActionResult & { data?: ClientHome }> {
  return mutateInOrg(ctx, { capability: 'contracts_issue', action: 'approve', flow: 'interior' }, async (tx, audit) => {
    if (!isUuid(input.contractId)) fail('record_not_found');
    const boq = await loadContractBoq(tx, input.contractId);
    const existing = boq.engagementId ?? (await findLightHome(tx, boq.projectId, boq.clientId));
    const home = existing ? { id: existing, created: false } : await insertLightHome(tx, ctx, boq.projectId, boq.clientId);
    await requireHomeShows(tx, home.id, input.contractId);
    const { minted, ...link } = await homeLink(tx, ctx, home.id);
    await audit({
      entity: 'design_engagement',
      entityId: home.id,
      action: 'issue',
      before: { home: home.created ? null : 'existing' },
      after: { contract_id: input.contractId, home: home.created ? 'created' : 'existing', link: minted ? 'minted' : (link.linkReason ?? 'shown') },
    });
    return { engagementId: home.id, ...link };
  });
}
