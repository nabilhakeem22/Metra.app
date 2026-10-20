// PR A3 DB-test fixture: an issued (or draft, or superseded) BOQ on a delivery,
// built by direct SQL over the BYPASSRLS connection, ready for
// generateExecutionContractCore. Not a test file. Teardown is fixture.ts's.
import { ownerQuery, seedClientProject } from './execution-fixture';

export interface SeededBoq {
  clientId: string;
  projectId: string;
  engagementId: string | null;
  boqId: string;
  /** Line count per section, by sort order. */
  linesPerSection: number[];
}

export type BoqState = 'draft' | 'issued' | 'superseded';

async function nextNumber(table: string, orgId: string): Promise<number> {
  const [row] = await ownerQuery<{ next: number }>(
    `select coalesce(max(number), 0) + 1 as next from public.${table} where org_id = $1`,
    [orgId],
  );
  return Number(row.next);
}

/** A delivery of the project in `state` (inserted there: no transition replayed). */
export async function seedDelivery(
  orgId: string,
  ids: { clientId: string; projectId: string },
  state: string,
): Promise<string> {
  const [row] = await ownerQuery<{ id: string }>(
    `insert into public.design_engagements (org_id, number, client_id, project_id, title_en, state)
     values ($1, $2, $3, $4, 'Fit-out design', $5) returning id`,
    [orgId, await nextNumber('design_engagements', orgId), ids.clientId, ids.projectId, state],
  );
  return row.id;
}

/**
 * A BOQ of `linesPerSection` lines. Line n of a section: qty n, unit price 100,
 * unit cost 60, discount 5 on every 7th, item code `S<section>-<n>`,
 * provisional on every 5th. `total` is the BOQ cache the contract copies
 * (default: the sum of the lines; set it to pin a worked figure).
 */
export async function seedBoq(
  orgId: string,
  opts: {
    linesPerSection?: number[];
    state?: BoqState;
    /** The delivery's state; null = a BOQ with no delivery (execution-only project). */
    deliveryState?: string | null;
    total?: string;
    project?: { clientId: string; projectId: string };
    /** An existing delivery to hang the BOQ on (instead of a new one). */
    engagementId?: string;
  } = {},
): Promise<SeededBoq> {
  const linesPerSection = opts.linesPerSection ?? [3, 2];
  const ids = opts.project ?? (await seedClientProject(orgId));
  const deliveryState = opts.deliveryState === undefined ? 'execution' : opts.deliveryState;
  const engagementId =
    opts.engagementId ?? (deliveryState === null ? null : await seedDelivery(orgId, ids, deliveryState));
  const [boq] = await ownerQuery<{ id: string }>(
    `insert into public.boqs (org_id, number, title_ar, title_en, client_id, project_id, engagement_id, status)
     values ($1, $2, 'مقايسة التنفيذ', 'Execution BOQ', $3, $4, $5, 'draft') returning id`,
    [orgId, await nextNumber('boqs', orgId), ids.clientId, ids.projectId, engagementId],
  );
  for (const [index, count] of linesPerSection.entries()) {
    const [section] = await ownerQuery<{ id: string }>(
      `insert into public.boq_sections (org_id, boq_id, title_en, title_ar, sort_order, section_subtotal)
       values ($1, $2, $3, $4, $5, 0) returning id`,
      [orgId, boq.id, `Section ${String(index + 1)}`, `القسم ${String(index + 1)}`, index],
    );
    await ownerQuery(
      `insert into public.boq_lines
         (org_id, boq_id, section_id, item_code, description_en, qty, unit, unit_cost, unit_price,
          discount_pct, line_cost, line_total, line_margin, provisional, sort_order)
       select $1, $2, $3, 'S' || $4::int || '-' || n, 'Line ' || n, n, 'sqm', 60, 100,
              case when n % 7 = 0 then 5 else 0 end, n * 60,
              n * 100 * (1 - case when n % 7 = 0 then 0.05 else 0 end),
              n * 100 * (1 - case when n % 7 = 0 then 0.05 else 0 end) - n * 60, n % 5 = 0, n
         from generate_series(1, $5::int) as n`,
      [orgId, boq.id, section.id, index + 1, count],
    );
    await ownerQuery(
      `update public.boq_sections s set section_subtotal = coalesce(
         (select sum(l.line_total) from public.boq_lines l where l.section_id = s.id), 0) where s.id = $1`,
      [section.id],
    );
  }
  await ownerQuery(
    `update public.boqs b set subtotal = t.total, total = coalesce($2::numeric, t.total),
            total_cost = t.cost, total_margin = t.total - t.cost
       from (select coalesce(sum(line_total), 0) total, coalesce(sum(line_cost), 0) cost
               from public.boq_lines where boq_id = $1) t
      where b.id = $1`,
    [boq.id, opts.total ?? null],
  );
  const state = opts.state ?? 'issued';
  if (state !== 'draft') await ownerQuery(`update public.boqs set status = 'issued' where id = $1`, [boq.id]);
  if (state === 'superseded') await ownerQuery(`update public.boqs set status = 'superseded' where id = $1`, [boq.id]);
  return { ...ids, engagementId, boqId: boq.id, linesPerSection };
}

/** A DRAFT contract generated from a proposal (the pre-Stage-2 kind), by SQL. */
export async function seedProposalContract(orgId: string): Promise<string> {
  const ids = await seedClientProject(orgId);
  const [proposal] = await ownerQuery<{ id: string }>(
    `insert into public.proposals (org_id, number, title_en, client_id, project_id)
     values ($1, $2, 'Quote', $3, $4) returning id`,
    [orgId, await nextNumber('proposals', orgId), ids.clientId, ids.projectId],
  );
  const [contract] = await ownerQuery<{ id: string }>(
    `insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id, original_value)
     values ($1, $2, 'Proposal contract', $3, $4, $5, 1000) returning id`,
    [orgId, await nextNumber('contracts', orgId), proposal.id, ids.clientId, ids.projectId],
  );
  return contract.id;
}
