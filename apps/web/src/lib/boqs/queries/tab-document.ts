import 'server-only';
// What the project's BOQ tab shows. An issued BOQ with no live contract can be
// replaced (lib/boqs/core/start-version.ts), so for a role that builds BOQs the
// tab shows the draft replacing it. selectCurrentProjectBoq stays the rule for
// every other reader: the issued BOQ stands until the draft is issued.
import { sql } from 'drizzle-orm';
import type { MetraDb } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { selectCurrentProjectBoq } from './current';
import { readBoqDetail } from './detail';
import type { ProjectBoq } from './types';

/** Where an issued BOQ stands, for a role that may replace it. */
export interface IssuedBoqVersion {
  /** The one contract generated from it (contracts_org_id_source_boq_unique), terminated or not. */
  contractId: string | null;
  /** That contract is not terminated, so the BOQ can no longer be replaced. */
  contractIsLive: boolean;
  /** The project's draft, the oldest if old rows hold more than one. */
  draftId: string | null;
}

/** One statement: it stands in for the tab's contract lookup, so a builder's page reads no more than before. */
async function readIssuedBoqVersion(tx: MetraDb, issuedBoqId: string, projectId: string): Promise<IssuedBoqVersion> {
  const rows = (await tx.execute(sql`
    select c.id as contract_id, c.status::text as contract_status,
           (select d.id from public.boqs d
             where d.project_id = ${projectId} and d.status = 'draft'
             order by d.created_at asc limit 1) as draft_id
      from (select 1) one
      left join public.contracts c on c.source_boq_id = ${issuedBoqId}
  `)) as unknown as Array<{ contract_id: string | null; contract_status: string | null; draft_id: string | null }>;
  const [row] = rows;
  return {
    contractId: row.contract_id,
    contractIsLive: row.contract_id !== null && row.contract_status !== 'terminated',
    draftId: row.draft_id,
  };
}

export interface BoqTabDocument {
  boq: ProjectBoq | null;
  /** Null unless the current BOQ is issued and the role builds BOQs (`canBuild`). */
  issuedVersion: IssuedBoqVersion | null;
}

/**
 * The BOQ the tab shows, in full: the project's current one, or, for a role that
 * builds BOQs, the draft in place of an issued BOQ with no live contract.
 */
export function getBoqTabDocument(
  ctx: OrgContext,
  projectId: string,
  opts: { showCost: boolean; canBuild: boolean },
): Promise<BoqTabDocument> {
  return withOrgContext(ctx, async (tx) => {
    const current = await selectCurrentProjectBoq(tx, projectId);
    if (!current) return { boq: null, issuedVersion: null };
    const issuedVersion = opts.canBuild && current.status === 'issued' ? await readIssuedBoqVersion(tx, current.id, projectId) : null;
    const replacing = issuedVersion && !issuedVersion.contractIsLive ? issuedVersion.draftId : null;
    return { boq: await readBoqDetail(tx, replacing ?? current.id, { showCost: opts.showCost }), issuedVersion };
  });
}
