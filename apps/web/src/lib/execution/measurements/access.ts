// Who may read and record site measurements (plan A18, the `site_measurements`
// row): owner, admin, project manager and site engineer record; the accountant
// and the viewer read. PURE and CLIENT-SAFE: the cores, the reads, the
// contract page, the measurements page and the delivery card ask one rule.
//
// Gated on that row ALONE, never on `contracts_generate`: the people on site
// measure without opening the contract page and its money. The CLIENT role is
// refused by name, as the billing surface refuses it (billing/access.ts).
import type { MemberRole } from '@/lib/permissions/roles';
import { can } from '@/lib/permissions/can';

export function mayReadMeasurements(role: MemberRole): boolean {
  return role !== 'client' && can(role, 'site_measurements', 'read');
}

export function mayRecordMeasurements(role: MemberRole): boolean {
  return role !== 'client' && can(role, 'site_measurements', 'create');
}
