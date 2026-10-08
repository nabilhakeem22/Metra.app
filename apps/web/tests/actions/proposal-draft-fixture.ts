// Shared set-up for the diff-based draft save dbtests (Round C, C2): a proposal
// in a fresh org, a document builder, and row-version reads over the BYPASSRLS
// connection.
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { createProposalCore, type DraftSaveReceipt, type SaveDraftInput } from '@/lib/proposals/core';
import { ctxFor, raw, seedOrg } from './fixture';

export type DraftSections = SaveDraftInput['sections'];

export interface DraftFixture {
  orgId: string;
  owner: OrgContext;
  /** A project manager at a firm that hides margin from PMs (margin-blind). */
  pm: OrgContext;
  proposalId: string;
}

export async function draftFixture(orgIds: string[]): Promise<DraftFixture> {
  const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  orgIds.push(orgId);
  const owner = ctxFor(orgId, ownerIds[0], 'owner');
  const pm = ctxFor(orgId, memberIds[0], 'project_manager');
  await raw.query(`update public.organizations set hide_margin_from_pm = true where id = '${orgId}'`);
  await createClientCore(owner, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(owner, {});
  await createProjectCore(owner, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    code: 'PRJ-1',
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(owner, {});
  const created = await createProposalCore(owner, { clientId: client.id, projectId: project.id });
  return { orgId, owner, pm, proposalId: (created as { data?: string }).data! };
}

const AR = 'توريد وتركيب أرضيات بورسلين مقاس ستين في ستين شامل المونة والترويب';

/** `total` lines in sections of 100, named by the receipt's ids when given. */
export function draftDocument(total: number, receipt?: DraftSaveReceipt['sections']): DraftSections {
  const sections: DraftSections = [];
  for (let index = 0, sectionIndex = 0; index < total; sectionIndex += 1) {
    const lines: DraftSections[number]['lines'] = [];
    for (let lineIndex = 0; lineIndex < 100 && index < total; lineIndex += 1, index += 1) {
      lines.push({
        id: receipt?.[sectionIndex]?.lineIds[lineIndex] ?? null,
        descriptionEn: `Supply and install porcelain ${index}`,
        descriptionAr: `${AR} ${index}`,
        qty: '12.5',
        unit: 'sqm',
        unitCost: '310.5',
        unitPrice: '450',
        discountPct: '0',
      });
    }
    sections.push({ id: receipt?.[sectionIndex]?.id ?? null, titleEn: `Section ${sectionIndex}`, lines });
  }
  return sections;
}

/** id -> xmin of every row of the draft, per table. */
export async function rowVersions(proposalId: string) {
  const read = async (table: string) =>
    new Map(
      (
        await raw.query<{ id: string; xmin: string }>(
          `select id, xmin::text as xmin from public.${table} where proposal_id = '${proposalId}'`,
        )
      ).map((row) => [row.id, row.xmin]),
    );
  return { sections: await read('proposal_sections'), lines: await read('proposal_lines') };
}

/** Ids whose row version differs between two reads (new ids count as changed). */
export function changedIds(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after].filter(([id, xmin]) => before.get(id) !== xmin).map(([id]) => id);
}

export async function walPosition(): Promise<string> {
  const [row] = await raw.query<{ lsn: string }>(`select pg_current_wal_lsn()::text as lsn`);
  return row.lsn;
}

export async function walBytesSince(start: string): Promise<number> {
  const [row] = await raw.query<{ bytes: string }>(
    `select pg_wal_lsn_diff(pg_current_wal_lsn(), '${start}')::bigint::text as bytes`,
  );
  return Number(row.bytes);
}

/** The stored document, row by row in document order, every column but ids and timestamps. */
export async function storedRows(proposalId: string) {
  return raw.query(
    `select s.sort_order as section_order, s.title_ar, s.title_en, s.section_subtotal::text,
            l.sort_order, l.cost_item_id, l.description_ar, l.description_en, l.qty::text, l.unit,
            l.unit_cost::text, l.unit_price::text, l.discount_pct::text, l.line_cost::text,
            l.line_total::text, l.line_margin::text
       from public.proposal_sections s
       left join public.proposal_lines l on l.section_id = s.id
      where s.proposal_id = '${proposalId}'
      order by s.sort_order, l.sort_order`,
  );
}
