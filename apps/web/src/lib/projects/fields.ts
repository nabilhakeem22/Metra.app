// A project's input and the paths a refusal can name. A plain module (a type
// import only), so the project sheet, the pure rules and the server core share it.
import type { ProjectStatus } from '@metra/db';

/** Every path a project refusal can name; `name` is the Arabic/English pair. */
export const PROJECT_FIELDS = [
  'code',
  'name',
  'nameEn',
  'nameAr',
  'clientId',
  'typeId',
  'description',
  'advancePct',
  'retentionPct',
  'startDate',
  'endDate',
  'city',
  'country',
  'address',
  'notes',
] as const;

export type ProjectField = (typeof PROJECT_FIELDS)[number];

/** What the new-project sheet renders (an edit adds the read-only code). */
export const PROJECT_CREATE_FIELDS = [
  'name',
  'nameEn',
  'nameAr',
  'clientId',
  'startDate',
  'endDate',
  'city',
  'country',
] as const satisfies readonly ProjectField[];

export interface ProjectInput {
  /** Optional: CREATE allocates one (P-YYYY-NNNN). Update must supply the stored
   *  code, which the form sends back read-only. */
  code?: string;
  nameEn?: string | null;
  nameAr?: string | null;
  clientId: string;
  typeId?: string | null;
  /** Optional on CREATE (a new project is `active`); update must send one. */
  status?: ProjectStatus;
  description?: string | null;
  advancePct?: string | null;
  retentionPct?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  notes?: string | null;
}
