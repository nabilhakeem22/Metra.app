// Stage 2 (0063) DB-test fixture: an EXECUTION contract built by direct SQL,
// before any core writes one (A3 builds generateExecutionContractCore). Not a
// test file. Rows are written over the BYPASSRLS connection, in the order the
// triggers allow: children while the BOQ / contract is a draft, then the status
// flip. Teardown is fixture.ts's (TEARDOWN_ORDER carries the six new tables).
import { createSql } from '@metra/db';
import { mintShareToken } from '@/lib/share/token';

const pg = createSql(process.env.DATABASE_URL as string, { max: 3, prepare: false });

export type ContractState = 'draft' | 'issued' | 'signed';

export interface ScheduleRow {
  labelEn: string;
  basis: 'percent' | 'amount';
  value: string;
}

export interface ExecutionContract {
  orgId: string;
  clientId: string;
  projectId: string;
  boqId: string;
  contractId: string;
  contractNumber: number;
  /** Section ids, by sort order. */
  sectionIds: string[];
  /** Line ids per section, by sort order. */
  lineIds: string[][];
  /** The raw share token of an issued / signed contract; null for a draft. */
  rawToken: string | null;
}

/** The SQLSTATE a statement was refused with, or null when it ran. */
export async function sqlstate(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    throw error;
  }
}

/** A query over the BYPASSRLS connection role, with bound parameters. */
export async function ownerQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pg.unsafe(text, params as never[])) as unknown as T[];
}

/**
 * Run `text` as metra_app inside a member's org context, the shape of an app
 * request (RLS and the grants apply). Commits on success.
 */
export async function appQuery<T = Record<string, unknown>>(
  orgId: string,
  userId: string,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return appQueryInSession<T>(orgId, userId, '', text, params);
}

/**
 * appQuery from one auth session: also sets `app.current_session_id` (the JWT
 * `session_id` claim the site device policies read; '' is no session).
 */
export async function appQueryInSession<T = Record<string, unknown>>(
  orgId: string,
  userId: string,
  sessionId: string,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pg.begin(async (tx) => {
    await tx`select set_config('app.current_org_id', ${orgId}, true)`;
    await tx`select set_config('app.current_user_id', ${userId}, true)`;
    await tx`select set_config('app.current_session_id', ${sessionId}, true)`;
    await tx.unsafe('set local role metra_app');
    return tx.unsafe(text, params as never[]);
  })) as unknown as T[];
}

/** Rewrite rows with every user trigger off (a tamper no app path can make). */
export async function tamper(text: string, params: unknown[] = []): Promise<void> {
  await pg.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = 'replica'`);
    await tx.unsafe(text, params as never[]);
  });
}

async function nextNumber(table: string, orgId: string): Promise<number> {
  const [row] = await ownerQuery<{ next: number }>(
    `select coalesce(max(number), 0) + 1 as next from public.${table} where org_id = $1`,
    [orgId],
  );
  return Number(row.next);
}

/** A client and a project of `orgId`. */
export async function seedClientProject(orgId: string): Promise<{ clientId: string; projectId: string }> {
  const [client] = await ownerQuery<{ id: string }>(
    `insert into public.clients (org_id, name_en) values ($1, 'Execution client') returning id`,
    [orgId],
  );
  const [project] = await ownerQuery<{ id: string }>(
    `insert into public.projects (org_id, code, name_en, client_id)
     values ($1, 'EXE-' || substr(md5(random()::text), 1, 8), 'Execution project', $2) returning id`,
    [orgId, client.id],
  );
  return { clientId: client.id, projectId: project.id };
}

/** The delivery a BOQ hangs off (its client and project are the contract's too). */
export interface DeliveryRef {
  id: string;
  clientId: string;
  projectId: string;
}

/**
 * An issued BOQ and the execution contract generated from it. `linesPerSection`
 * sets the shape; line n of a section has qty n, unit price 100, unit cost 60,
 * item code `A-<n>`, and is provisional when n is a multiple of 5. With
 * `delivery`, the BOQ is that delivery's (boqs.engagement_id, plan A26).
 */
export async function seedExecutionContract(
  orgId: string,
  opts: {
    linesPerSection?: number[];
    state?: ContractState;
    schedule?: ScheduleRow[];
    delivery?: DeliveryRef;
  } = {},
): Promise<ExecutionContract> {
  const linesPerSection = opts.linesPerSection ?? [3];
  const state = opts.state ?? 'issued';
  const { clientId, projectId } = opts.delivery ?? (await seedClientProject(orgId));

  const [boq] = await ownerQuery<{ id: string }>(
    `insert into public.boqs (org_id, number, title_en, client_id, project_id, engagement_id, status, total, subtotal)
     values ($1, $2, 'Execution BOQ', $3, $4, $5, 'draft', 0, 0) returning id`,
    [orgId, await nextNumber('boqs', orgId), clientId, projectId, opts.delivery?.id ?? null],
  );
  await ownerQuery(`update public.boqs set status = 'issued' where id = $1`, [boq.id]);

  const contractNumber = await nextNumber('contracts', orgId);
  const [contract] = await ownerQuery<{ id: string }>(
    `insert into public.contracts
       (org_id, number, title_en, source_boq_id, client_id, project_id, status,
        tax_rate, supervision_pct, original_value, taxable_base, tax_amount, supervision_amount,
        total_cost, total_margin, end_date)
     values ($1, $2, 'Execution contract', $3, $4, $5, 'draft',
        14, 10, 124000, 100000, 14000, 10000, 60000, 40000, '2026-12-31')
     returning id`,
    [orgId, contractNumber, boq.id, clientId, projectId],
  );

  const sectionIds: string[] = [];
  const lineIds: string[][] = [];
  for (const [index, count] of linesPerSection.entries()) {
    const [section] = await ownerQuery<{ id: string }>(
      `insert into public.contract_sections (org_id, contract_id, title_en, sort_order, section_subtotal)
       values ($1, $2, $3, $4, 0) returning id`,
      [orgId, contract.id, `Section ${String(index + 1)}`, index],
    );
    sectionIds.push(section.id);
    const lines = await ownerQuery<{ id: string }>(
      `insert into public.contract_lines
         (org_id, contract_id, section_id, item_code, description_en, qty, unit,
          unit_cost, unit_price, line_cost, line_total, line_margin, provisional, sort_order)
       select $1, $2, $3, 'A-' || n, 'Line ' || n, n, 'sqm', 60, 100, n * 60, n * 100, n * 40,
              n % 5 = 0, n
         from generate_series(1, $4::int) as n
       order by n
       returning id, sort_order`,
      [orgId, contract.id, section.id, count],
    );
    lineIds.push(
      [...(lines as unknown as Array<{ id: string; sort_order: number }>)]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((line) => line.id),
    );
  }

  for (const [index, row] of (opts.schedule ?? []).entries()) {
    await ownerQuery(
      `insert into public.contract_payment_milestones (org_id, contract_id, label_en, basis, value, sort_order)
       values ($1, $2, $3, $4, $5, $6)`,
      [orgId, contract.id, row.labelEn, row.basis, row.value, index],
    );
  }

  let rawToken: string | null = null;
  if (state !== 'draft') {
    const token = mintShareToken();
    rawToken = token.raw;
    await ownerQuery(
      `update public.contracts set status = 'issued', token_hash = $2,
              share_expires_at = now() + interval '30 days' where id = $1`,
      [contract.id, token.hash],
    );
    if (state === 'signed') {
      await ownerQuery(`update public.contracts set status = 'signed' where id = $1`, [contract.id]);
    }
  }

  return {
    orgId,
    clientId,
    projectId,
    boqId: boq.id,
    contractId: contract.id,
    contractNumber,
    sectionIds,
    lineIds,
    rawToken,
  };
}

/** A schedule milestone on a DRAFT contract (insert it before the issue flip). */
export async function seedMilestone(
  orgId: string,
  contractId: string,
  sortOrder: number,
): Promise<string> {
  const [row] = await ownerQuery<{ id: string }>(
    `insert into public.contract_payment_milestones (org_id, contract_id, label_en, basis, value, sort_order)
     values ($1, $2, 'Milestone', 'percent', 50, $3) returning id`,
    [orgId, contractId, sortOrder],
  );
  return row.id;
}

/** An issued payment request; `kind` defaults to a final account (no target). */
export async function seedRequest(
  orgId: string,
  contractId: string,
  issuedBy: string,
  target: { milestoneId?: string; variationOrderId?: string } = {},
  amount = '500',
): Promise<string> {
  const kind = target.milestoneId ? 'milestone' : target.variationOrderId ? 'variation' : 'final_account';
  const [row] = await ownerQuery<{ id: string }>(
    `insert into public.payment_requests
       (org_id, contract_id, number, kind, milestone_id, variation_order_id, amount, tax_amount, issued_on, issued_by)
     values ($1, $2, $3, $4, $5, $6, $7, 0, current_date, $8) returning id`,
    [
      orgId,
      contractId,
      await nextNumber('payment_requests', orgId),
      kind,
      target.milestoneId ?? null,
      target.variationOrderId ?? null,
      amount,
      issuedBy,
    ],
  );
  return row.id;
}

/**
 * A variation order on `contractId`, walked to `status` through the transitions
 * the immutability trigger whitelists. `tokenHash` is set while it is a draft.
 */
export async function seedVariation(
  orgId: string,
  contract: { contractId: string; projectId: string },
  status: 'draft' | 'internal_approved' | 'issued' | 'approved' | 'rejected',
  opts: { netDelta?: string; timeExtensionDays?: number | null; tokenHash?: string | null } = {},
): Promise<{ id: string; number: number }> {
  const number = await nextNumber('variation_orders', orgId);
  const [row] = await ownerQuery<{ id: string }>(
    `insert into public.variation_orders
       (org_id, number, contract_id, project_id, status, title_en, net_delta, time_extension_days,
        token_hash, share_expires_at)
     values ($1, $2, $3, $4, 'draft', 'Change order', $5, $6, $7,
        case when $7::text is null then null else now() + interval '30 days' end)
     returning id`,
    [
      orgId,
      number,
      contract.contractId,
      contract.projectId,
      opts.netDelta ?? '10000',
      opts.timeExtensionDays ?? null,
      opts.tokenHash ?? null,
    ],
  );
  const path = ['internal_approved', 'issued', status === 'rejected' ? 'rejected' : 'approved'];
  const stop = status === 'draft' ? 0 : path.indexOf(status) + 1;
  for (const next of path.slice(0, stop)) {
    await ownerQuery(`update public.variation_orders set status = $2 where id = $1`, [row.id, next]);
  }
  return { id: row.id, number };
}

export async function closeExecutionFixture(): Promise<void> {
  await pg.end();
}
