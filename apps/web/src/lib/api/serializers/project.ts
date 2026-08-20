import type { Project } from '@metra/db';
import { toApiMoney, toIso } from './shared';

/** Optional resolved type name (present on the detail query). */
export interface ProjectWithTypeNames extends Project {
  typeNameEn?: string | null;
  typeNameAr?: string | null;
}

/**
 * Public v1 shape for a project. Projects carry NO cost/margin columns; advance/
 * retention are percentages exposed as 2-decimal strings.
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
    description: row.description,
    advance_pct: toApiMoney(row.advancePct),
    retention_pct: toApiMoney(row.retentionPct),
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
