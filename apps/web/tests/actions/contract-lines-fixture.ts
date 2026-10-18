// TEST-ONLY contracts for the bounded contract page (PR B1), written over the
// BYPASSRLS connection: a draft contract with whatever sections and lines a
// case needs, without the proposal flow's caps.
import { raw } from './fixture';

const quote = (text: string | null) => (text === null ? 'null' : `'${text.replace(/'/g, "''")}'`);

export interface FixtureSection {
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  lines: Array<{ descriptionAr: string | null; descriptionEn: string | null; sortOrder: number }>;
}

/** A client, a project, a proposal and a draft contract numbered `number`; the contract id. */
export async function seedContractShell(orgId: string, number: number): Promise<string> {
  const [{ client, project }] = await raw.query<{ client: string; project: string }>(
    `with c as (insert into public.clients (org_id, name_en) values ('${orgId}', 'Client ${number}') returning id)
     insert into public.projects (org_id, code, name_en, client_id) select '${orgId}', 'P-${number}', 'Villa', id from c
     returning client_id as client, id as project`,
  );
  const [{ id }] = await raw.query<{ id: string }>(
    `with p as (insert into public.proposals (org_id, number, title_en, client_id, project_id)
                values ('${orgId}', ${number}, 'Quote', '${client}', '${project}') returning id)
     insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id)
     select '${orgId}', ${number}, 'Fit-out', id, '${client}', '${project}' from p returning id`,
  );
  return id;
}

/** The given sections and lines (each line 1 sqm at 100) with stored subtotals; the section ids in input order. */
export async function seedSections(orgId: string, contractId: string, sections: FixtureSection[]): Promise<string[]> {
  const ids: string[] = [];
  for (const section of sections) {
    const [{ id }] = await raw.query<{ id: string }>(
      `insert into public.contract_sections (org_id, contract_id, title_ar, title_en, sort_order, section_subtotal)
       values ('${orgId}', '${contractId}', ${quote(section.titleAr)}, ${quote(section.titleEn)}, ${section.sortOrder}, ${section.lines.length * 100})
       returning id`,
    );
    if (section.lines.length > 0) {
      const values = section.lines.map(
        (line) =>
          `('${orgId}', '${contractId}', '${id}', ${quote(line.descriptionAr)}, ${quote(line.descriptionEn)}, 1, 'sqm', 70, 100, 70, 100, 30, ${line.sortOrder})`,
      );
      await raw.query(
        `insert into public.contract_lines (org_id, contract_id, section_id, description_ar, description_en,
           qty, unit, unit_cost, unit_price, line_cost, line_total, line_margin, sort_order) values ${values.join(', ')}`,
      );
    }
    ids.push(id);
  }
  return ids;
}

/**
 * `sections` x `perSection` lines «بند s.g» / "Line s.g". The LAST section's
 * lines all share sort_order 0, so only their ids order them.
 */
export async function seedGridContract(orgId: string, number: number, sections: number, perSection: number) {
  const contractId = await seedContractShell(orgId, number);
  const sectionIds = await seedSections(
    orgId,
    contractId,
    Array.from({ length: sections }, (_, s) => ({
      titleAr: null,
      titleEn: `Section ${s}`,
      sortOrder: s,
      lines: Array.from({ length: perSection }, (__, g) => ({
        descriptionAr: `بند ${s}.${g}`,
        descriptionEn: `Line ${s}.${g}`,
        sortOrder: s === sections - 1 ? 0 : g,
      })),
    })),
  );
  return { contractId, sectionIds };
}
