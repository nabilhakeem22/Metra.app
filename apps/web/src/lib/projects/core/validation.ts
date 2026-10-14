// The project-input boundary create and update share: the shape checks no form
// can fail (`malformed`), the typed rules (../field-rules, every refusal under
// its field), the database refusals named for a race past them, and the in-tx
// client-usability check. Internal to create/update (NOT re-exported by the
// `@/lib/projects/core` barrel).
import { clients, PROJECT_STATUSES, type MetraDb, type ProjectStatus } from '@metra/db';
import { eq } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import type { ConstraintRefusal } from '@/lib/actions/mutation-failure';
import { PERCENT_REFUSAL } from '@/lib/validation/number-field-rules';
import { err, type ActionResult } from '@/lib/actions/result';
import { isUuid } from '@/lib/uuid';
import { clean } from '@/lib/validation/text';
import { readProjectInput, type ProjectRules, type ProjectValues } from '../field-rules';
import type { ProjectInput } from '../fields';

export type Validated = ProjectValues & { status: ProjectStatus };

/** Named constraints a write can lose a race on, each answered under its field. */
export const PROJECT_REFUSALS: readonly ConstraintRefusal[] = [
  { constraint: 'projects_org_id_code_unique', field: 'code', error: { code: 'code_taken' } },
  { constraint: 'projects_advance_pct_range', field: 'advancePct', error: PERCENT_REFUSAL },
  { constraint: 'projects_retention_pct_range', field: 'retentionPct', error: PERCENT_REFUSAL },
  { constraint: 'projects_client_same_org_fk', field: 'clientId', error: { code: 'no_longer_exists' } },
  { constraint: 'projects_type_same_org_fk', field: 'typeId', error: { code: 'no_longer_exists' } },
];

function isStatus(value: unknown): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value as string);
}

/** The normalized row, or the answer that refuses it. */
export function validate(input: ProjectInput, rules: ProjectRules = {}): ActionResult | Validated {
  const status = input.status;
  // A status outside the select, or a type id that is no id: no form sends these.
  if (!isStatus(status)) return err('malformed');
  const typeId = clean(input.typeId);
  if (typeId && !isUuid(typeId)) return err('malformed');
  const read = readProjectInput(input, rules);
  if (!read.ok) return fieldsFailed(read.errors);
  return { ...read.values, status };
}

export function isErr(v: ActionResult | Validated): v is ActionResult {
  return 'ok' in v;
}

// The client must exist AND be active in THIS org (RLS scopes the read).
export async function assertClientUsable(tx: MetraDb, clientId: string): Promise<void> {
  const [client] = await tx
    .select({ id: clients.id, active: clients.active })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client || !client.active) failFields({ clientId: { code: 'client_required' } });
}
