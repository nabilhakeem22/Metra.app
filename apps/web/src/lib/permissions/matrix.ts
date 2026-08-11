import type { Capability, MemberRole } from './roles';

// §2.2 permission matrix, encoded verbatim. Each cell is a letter string:
// C create · R read · U update · A approve/issue · '' none.
//
// Scoping notes from the PRD (own / assigned / accept / sign) are NOT encoded
// here — they are row-level constraints enforced at query time, not capability
// grants. `margin_pnl` for PM and the firm_dashboard asterisks are gated by org
// settings (hide_margin_from_pm / restrict_firm_dashboard); the base grant is R.
//
// Column order: owner, admin, project_manager, site_engineer, accountant, client, viewer
const COLS: MemberRole[] = [
  'owner',
  'admin',
  'project_manager',
  'site_engineer',
  'accountant',
  'client',
  'viewer',
];

const ROWS: Record<Capability, string[]> = {
  clients: ['CRUA', 'CRUA', 'CRU', 'R', 'R', '', 'R'],
  projects: ['CRUA', 'CRUA', 'CRU', 'R', 'R', 'R', 'R'],
  price_book: ['CRUA', 'CRUA', 'R', '', 'R', '', ''],
  proposals_build: ['CRU', 'CRU', 'CRU', '', '', '', 'R'],
  // 'client' send removed (S1): a client-role session must not mint share links /
  // expire proposals it cannot read. Client acceptance is the unauthenticated
  // token path, which never consults this matrix.
  proposals_send: ['A', 'A', '', '', '', '', ''],
  contracts_generate: ['CRU', 'CRU', '', '', '', '', 'R'],
  contracts_issue: ['A', 'A', '', '', '', 'A', ''],
  variations_draft: ['CRU', 'CRU', 'CRU', 'C', '', '', 'R'],
  variations_price: ['A', 'A', '', '', '', 'A', ''],
  tasks_schedule: ['CRUA', 'CRUA', 'CRUA', 'RU', 'R', 'R', 'R'],
  cost_entries: ['CRUA', 'CRUA', 'CRU', 'CRU', 'CRUA', '', ''],
  cost_entry_approval: ['A', 'A', 'A', '', 'A', '', ''],
  custody_issue: ['A', 'A', '', '', 'A', '', ''],
  custody_settle: ['RU', 'RU', 'RU', 'C', 'CRUA', '', ''],
  invoices_draft: ['CRU', 'CRU', 'CRU', '', 'CRU', '', 'R'],
  invoices_issue: ['A', 'A', '', '', 'A', '', ''],
  payments: ['CRU', 'CRU', 'R', '', 'CRUA', 'R', 'R'],
  margin_pnl: ['R', 'R', 'R', '', 'R', '', ''],
  firm_dashboard: ['R', 'R', '', '', 'R', '', 'R'],
  users_settings: ['CRUA', 'CRU', '', '', '', '', ''],
};

export type PermissionMatrix = Record<Capability, Record<MemberRole, string>>;

function buildMatrix(): PermissionMatrix {
  const out = {} as PermissionMatrix;
  for (const cap of Object.keys(ROWS) as Capability[]) {
    const cells = ROWS[cap];
    const byRole = {} as Record<MemberRole, string>;
    COLS.forEach((role, i) => {
      byRole[role] = cells[i] ?? '';
    });
    out[cap] = byRole;
  }
  return out;
}

export const PERMISSION_MATRIX: PermissionMatrix = buildMatrix();
