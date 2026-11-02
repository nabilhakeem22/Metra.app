// The client home behind an execution contract: the delivery whose link /d
// shows the contract's Execution tab, and that link. `ensureClientHomeCore` is
// what the contract page's "Client page" control and the contract's issue run:
// it finds the pair's one delivery, creating a LIGHT one only when the pair has
// none, and hands back its live link.
//
// THE HOME IS FOUND BY ITS CLIENT TOO (H3 security S2): a delivery owns only its
// own client's BOQs (app_delivery_boqs), so the pair is the BOQ's project and
// client, and the BOQ's client is the one a light delivery is born for. A pair
// has one delivery, so one link (lib/engagements/design-first.ts): a light
// delivery is never born beside a design one.
import { boqs, contracts, designEngagements, projects, type MetraDb } from '@metra/db';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { requireDesignFinished, type ProjectClient } from '@/lib/engagements/pair-home';
import { isUuid } from '@/lib/uuid';
import { homeLiveLink } from './home-live-link';
import { requireHomeShows } from './home-shows';
import type { ClientHomeLink } from './types';

/** The home, whether its client can get a code, and its live link (the RAW token, never logged) or why the studio cannot be shown one. */
type ClientHome = { engagementId: string; clientHasEmail: boolean } & ClientHomeLink;

/**
 * Who may open a contract's client home: whoever issues contracts (owner and
 * admin), in the interior flow. Every such role may also share delivery links
 * (DELIVERY_LINK_GATE; ./ensure-gate.test.ts pins it), so the home's link is
 * always theirs to see.
 */
export const CLIENT_HOME_GATE = { capability: 'contracts_issue', action: 'approve', flow: 'interior' } as const;

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
  if (contract.status === 'terminated') fail('contract_terminated');
  if (!HOME_CONTRACT_STATUSES.has(contract.status)) fail('contract_not_issued');
  return requireInOrg(
    tx,
    boqs,
    contract.sourceBoqId,
    { engagementId: boqs.engagementId, projectId: boqs.projectId, clientId: boqs.clientId },
    'boq_not_found',
  );
}

/**
 * The light delivery of a pair with none: born at `execution` with entry_phase
 * 'execution', titled with the project's names. allocateNumber's per-org lock
 * serialises this against a create and against another light insert, and the
 * gate read after it sees whichever won: its home is the answer, its open design
 * the refusal.
 */
async function insertLightHome(tx: MetraDb, ctx: OrgContext, pair: ProjectClient): Promise<{ id: string; created: boolean }> {
  const project = await requireInOrg(tx, projects, pair.projectId, { nameAr: projects.nameAr, nameEn: projects.nameEn }, 'record_not_found');
  const number = await allocateNumber(tx, ctx.orgId, 'design_engagement', 'design_engagements', 'number');
  const gate = await requireDesignFinished(tx, pair);
  if (gate.kind === 'home') return { id: gate.delivery.id, created: false };
  const [row] = await tx
    .insert(designEngagements)
    .values({
      orgId: ctx.orgId,
      number,
      titleAr: project.nameAr,
      titleEn: project.nameEn,
      clientId: pair.clientId,
      projectId: pair.projectId,
      state: 'execution',
      entryPhase: 'execution',
    })
    .returning({ id: designEngagements.id });
  return { id: row.id, created: true };
}

/**
 * The client home of one BOQ contract, issued or signed. Refused while design
 * runs or stands closed on the pair (`design_open`, `design_only_closed`). The
 * home is the delivery the BOQ was generated for, else the pair's home, else a
 * new light delivery. Its link is the live one, minted or renewed when it has
 * none (homeLiveLink); when it cannot be shown, `link` is null and `linkReason`
 * says why. CLIENT_HOME_GATE. Audited on the delivery as an `issue`, as the
 * share cores are.
 */
export async function ensureClientHomeCore(
  ctx: OrgContext,
  input: { contractId: string },
): Promise<ActionResult & { data?: ClientHome }> {
  return mutateInOrg(ctx, CLIENT_HOME_GATE, async (tx, audit) => {
    if (!isUuid(input.contractId)) fail('record_not_found');
    // The id as the database answers it (lower case), so the home's contract compares equal.
    const contractId = input.contractId.toLowerCase();
    const boq = await loadContractBoq(tx, contractId);
    const pair = { projectId: boq.projectId, clientId: boq.clientId };
    const gate = await requireDesignFinished(tx, pair);
    const existing = boq.engagementId ?? (gate.kind === 'home' ? gate.delivery.id : null);
    const home = existing ? { id: existing, created: false } : await insertLightHome(tx, ctx, pair);
    const { clientHasEmail } = await requireHomeShows(tx, home.id, contractId);
    const { issued, ...link } = await homeLiveLink(tx, home.id);
    await audit({
      entity: 'design_engagement',
      entityId: home.id,
      action: 'issue',
      before: { home: home.created ? null : 'existing' },
      after: { contract_id: contractId, home: home.created ? 'created' : 'existing', link: issued ?? link.linkReason },
    });
    return { engagementId: home.id, clientHasEmail, ...link };
  });
}
