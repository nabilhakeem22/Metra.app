// DB-test helpers for a new BOQ version: what a BOQ holds, as rows, and the render
// double the issue path needs (no Chromium in a dbtest). Not a test file. Rows are
// read over the BYPASSRLS connection; teardown is fixture.ts's.
import { randomUUID } from 'node:crypto';
import { ownerQuery } from './execution-fixture';

export interface BoqContent {
  header: Record<string, string | null>;
  sections: Array<Record<string, string | number | null>>;
  lines: Array<Record<string, string | number | boolean | null>>;
}

/** Everything a version must carry, in order, with no ids: two BOQs compare equal by this. */
export async function boqContent(boqId: string): Promise<BoqContent> {
  const [header] = await ownerQuery<Record<string, string | null>>(
    `select title_ar, title_en, currency, notes_ar, notes_en, discount_pct::text, subtotal::text, discount_amount::text,
            total::text, total_cost::text, total_margin::text
       from public.boqs where id = $1`,
    [boqId],
  );
  const sections = await ownerQuery<Record<string, string | number | null>>(
    `select title_ar, title_en, sort_order, section_subtotal::text from public.boq_sections where boq_id = $1 order by sort_order, id`,
    [boqId],
  );
  const lines = await ownerQuery<Record<string, string | number | boolean | null>>(
    `select s.sort_order as section_order, l.sort_order, l.cost_item_id, l.item_code, l.description_ar, l.description_en,
            l.qty::text, l.unit::text, l.unit_cost::text, l.unit_price::text, l.discount_pct::text, l.line_cost::text,
            l.line_total::text, l.line_margin::text, l.provisional
       from public.boq_lines l join public.boq_sections s on s.id = l.section_id
      where l.boq_id = $1 order by s.sort_order, l.sort_order, l.id`,
    [boqId],
  );
  return { header, sections, lines };
}

export async function boqRow(boqId: string): Promise<{ status: string; engagement_id: string | null; client_id: string; supersedes_id: string | null }> {
  const [row] = await ownerQuery<{ status: string; engagement_id: string | null; client_id: string; supersedes_id: string | null }>(
    `select status::text as status, engagement_id, client_id, supersedes_id from public.boqs where id = $1`,
    [boqId],
  );
  return row;
}

export async function draftsOf(projectId: string): Promise<string[]> {
  const rows = await ownerQuery<{ id: string }>(`select id from public.boqs where project_id = $1 and status = 'draft'`, [projectId]);
  return rows.map((row) => row.id);
}

export async function firstLineOf(boqId: string): Promise<string> {
  const [row] = await ownerQuery<{ id: string }>(
    `select l.id from public.boq_lines l join public.boq_sections s on s.id = l.section_id where l.boq_id = $1 order by s.sort_order, l.sort_order limit 1`,
    [boqId],
  );
  return row.id;
}

/** What renderAndStoreClientBoqPdf leaves: a file row, and no Chromium. */
export async function fakeClientPdf(ctx: { orgId: string }, input: { engagementId: string }): Promise<{ fileId: string; label: string }> {
  const [file] = await ownerQuery<{ id: string }>(
    `insert into public.files (org_id, entity, entity_id, object_key, original_name)
     values ($1, 'engagement', $2, $3, 'BQ.pdf') returning id`,
    [ctx.orgId, input.engagementId, `${ctx.orgId}/engagement/${randomUUID()}`],
  );
  return { fileId: file.id, label: 'BQ.pdf' };
}
