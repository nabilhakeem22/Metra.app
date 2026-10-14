// Where each project field's refusal is shown. A plain module, so the sheet's
// field groups and their tests share one map.
import type { ProjectField } from '@/lib/projects/fields';

/** What a FormField needs from the sheet's refusal state for one field. */
export type ProjectFieldBinding = (field: ProjectField) => { error: string | undefined; onEdit: () => void };

const CONTROL_ID: Partial<Record<ProjectField, string>> = {
  name: 'pr-nameEn',
  clientId: 'pr-client',
  startDate: 'pr-start',
  endDate: 'pr-end',
};

/** The control a field's refusal sits under: the pair `name` under the English name. */
export function projectControlId(field: ProjectField): string {
  return CONTROL_ID[field] ?? `pr-${field}`;
}
