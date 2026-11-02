// Design first, one link (owner ruling, Nov 2 2026) DB-test fixture: what a pair
// holds, and how a refusal names a delivery. Not a test file. Rows are written
// over the BYPASSRLS connection; teardown is fixture.ts's.
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { ownerQuery, seedClientProject } from './execution-fixture';

export const CHARGES = { taxRate: '14', supervisionPct: '10' };

export const SPLIT = [
  { labelAr: null, labelEn: 'Advance', basis: 'percent', value: '50' },
  { labelAr: null, labelEn: 'Works', basis: 'percent', value: '30' },
  { labelAr: null, labelEn: 'Handover', basis: 'percent', value: '20' },
];

export interface PairRow {
  id: string;
  state: string;
  entry_phase: string;
  client_id: string;
  token_hash: string | null;
}

/** Every delivery of the project, oldest number first. */
export function projectRows(projectId: string): Promise<PairRow[]> {
  return ownerQuery<PairRow>(
    `select id, state::text as state, entry_phase, client_id, token_hash
       from public.design_engagements where project_id = $1 order by number`,
    [projectId],
  );
}

export async function contractCount(projectId: string): Promise<number> {
  const [row] = await ownerQuery<{ count: number }>(`select count(*)::int as count from public.contracts where project_id = $1`, [projectId]);
  return row.count;
}

/** The params a design-first refusal carries for this delivery. */
export async function targetOf(deliveryId: string): Promise<{ delivery: string; deliveryId: string }> {
  const [row] = await ownerQuery<{ number: number; created_at: Date }>(
    `select number, created_at from public.design_engagements where id = $1`,
    [deliveryId],
  );
  return { delivery: formatDocNumber('DE', row.number, docYear(null, row.created_at)), deliveryId };
}

/** A second client of the org. */
export async function seedOtherClient(orgId: string): Promise<string> {
  return (await seedClientProject(orgId)).clientId;
}
