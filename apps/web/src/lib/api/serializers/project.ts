import type { Project } from '@metra/db';
import { toIso } from './shared';

/** Optional resolved type name (present on the detail query). */
export interface ProjectWithTypeNames extends Project {
  typeNameEn?: string | null;
  typeNameAr?: string | null;
}

/**
 * Public v1 shape for a project. Projects carry NO cost/margin columns; advance/
 * retention are percentages exposed as scale-4 money strings.
 */
export interface PublicProject {
  id: string;
  code: string;
  name_ar: string | null;
  name_en: string | null;
  client_id: string;
  type_id: string | null;
  type_name_ar: string | null;
  type_name_en: string | null;
  status: string;
  contract_ref: string | null;
  description: string | null;
  advance_pct: string;
  retention_pct: string;
  start_date: string | null;
  end_date: string | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export function serializeProject(row: ProjectWithTypeNames): PublicProject {
  return {
    id: row.id,
    code: row.code,
    name_ar: row.nameAr,
    name_en: row.nameEn,
    client_id: row.clientId,
    type_id: row.typeId,
    type_name_ar: row.typeNameAr ?? null,
    type_name_en: row.typeNameEn ?? null,
    status: row.status,
    contract_ref: row.contractRef,
    description: row.description,
    advance_pct: row.advancePct,
    retention_pct: row.retentionPct,
    start_date: row.startDate,
    end_date: row.endDate,
    city: row.city,
    address: row.address,
    notes: row.notes,
    active: row.active,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}
