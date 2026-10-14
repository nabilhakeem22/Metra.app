// The rules a project's typed values must keep. Pure and client-safe: the sheet
// runs them before sending, and the core runs them again on what arrived. Every
// broken rule is reported at once, under its own field. The shape checks no form
// can fail (status, type id) stay in the core (`malformed`).
import { hasFieldErrors, type FieldError, type FieldErrors } from '@/lib/actions/field-errors';
import { isUuid } from '@/lib/uuid';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { normalizePercent } from '@/lib/validation/percent';
import { clean } from '@/lib/validation/text';
import { maxCharacters } from '@/lib/validation/text-field-rules';
import type { ProjectField, ProjectInput } from './fields';

/** Boundary length caps (defense-in-depth), mirroring org/core profileWithinLimits. */
const PROJECT_LIMITS = { code: 64, name: 200, city: 120, address: 300, notes: 2000, description: 4000 } as const;

export interface ProjectRules {
  /** Update edits a row that already has a code; create allocates one. */
  requireCode?: boolean;
  /** Create only: 301 of 307 projects in production have no dates, so an edit
   *  must not demand one (the same forward-only shape as the client phone). */
  requireStartDate?: boolean;
}

/** The typed values as the database stores them. */
export interface ProjectValues {
  /** Null when the caller supplied none: create then ALLOCATES one. */
  code: string | null;
  nameEn: string | null;
  nameAr: string | null;
  clientId: string;
  typeId: string | null;
  description: string | null;
  advancePct: string;
  retentionPct: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  notes: string | null;
}

export type ProjectRead = { ok: true; values: ProjectValues } | { ok: false; errors: FieldErrors<ProjectField> };

/** The fields a typed rule can refuse; the type id and country carry none (the
 *  type's existence is the database's foreign key, the country is uncapped). */
type RuledField = Exclude<ProjectField, 'typeId' | 'country'>;

/** An end date before the start, compared as dates (not as text). */
function endsBeforeStart(startDate: string | null, endDate: string | null): boolean {
  if (!startDate || !endDate) return false;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end < start;
}

function codeRefusal(code: string | null, rules: ProjectRules): FieldError | null {
  if (!code) return rules.requireCode ? { code: 'code_required' } : null;
  return maxCharacters(code, PROJECT_LIMITS.code);
}

/** Read every typed value at once, or say what is wrong with each of them. */
export function readProjectInput(input: ProjectInput, rules: ProjectRules = {}): ProjectRead {
  const code = input.code?.trim() || null;
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  // A missing OR malformed client id is "pick a client" (no DB uuid-cast throw).
  const clientId = input.clientId?.trim() ?? '';
  const startDate = clean(input.startDate);
  const endDate = clean(input.endDate);
  const advancePct = normalizePercent(input.advancePct);
  const retentionPct = normalizePercent(input.retentionPct);
  const text = {
    description: clean(input.description),
    city: clean(input.city),
    country: clean(input.country),
    address: clean(input.address),
    notes: clean(input.notes),
  };
  const errors = collectFieldErrors<RuledField>({
    code: codeRefusal(code, rules),
    name: nameEn || nameAr ? null : { code: 'name_required' },
    nameEn: maxCharacters(nameEn, PROJECT_LIMITS.name),
    nameAr: maxCharacters(nameAr, PROJECT_LIMITS.name),
    clientId: isUuid(clientId) ? null : { code: 'client_required' },
    description: maxCharacters(text.description, PROJECT_LIMITS.description),
    advancePct: advancePct === null ? { code: 'invalid_percentage' } : null,
    retentionPct: retentionPct === null ? { code: 'invalid_percentage' } : null,
    startDate: rules.requireStartDate && !startDate ? { code: 'start_date_required' } : null,
    endDate: endsBeforeStart(startDate, endDate) ? { code: 'invalid_dates' } : null,
    city: maxCharacters(text.city, PROJECT_LIMITS.city),
    address: maxCharacters(text.address, PROJECT_LIMITS.address),
    notes: maxCharacters(text.notes, PROJECT_LIMITS.notes),
  });
  if (hasFieldErrors(errors) || advancePct === null || retentionPct === null) return { ok: false, errors };
  const typeId = clean(input.typeId);
  return {
    ok: true,
    values: { code, nameEn, nameAr, clientId, typeId, advancePct, retentionPct, startDate, endDate, ...text },
  };
}

/** The sheet's pre-check: the same rules, as the refusals under each field. */
export function projectFieldErrors(input: ProjectInput, rules: ProjectRules = {}): FieldErrors<ProjectField> {
  const read = readProjectInput(input, rules);
  return read.ok ? {} : read.errors;
}
