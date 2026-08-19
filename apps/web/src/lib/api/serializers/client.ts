import type { Client } from '@metra/db';
import { toIso } from './shared';

/**
 * Public v1 shape for a client. This interface is the single source of truth for
 * what the API exposes (S1): regulated/sensitive identifiers — national_id,
 * tax_card_number, commercial_register, credit_terms — are DELIBERATELY OMITTED.
 * Clients carry NO cost/margin columns; advance_pct / retention_pct are
 * percentages (not cost) exposed as scale-4 money strings.
 */
export interface PublicClient {
  id: string;
  name_ar: string | null;
  name_en: string | null;
  type: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  tax_registration_number: string | null;
  segment: string | null;
  lead_source: string | null;
  advance_pct: string;
  retention_pct: string;
  notes: string | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export function serializeClient(row: Client): PublicClient {
  return {
    id: row.id,
    name_ar: row.nameAr,
    name_en: row.nameEn,
    type: row.type,
    contact_name: row.contactName,
    email: row.email,
    phone: row.phone,
    city: row.city,
    address: row.address,
    tax_registration_number: row.taxRegistrationNumber,
    segment: row.segment,
    lead_source: row.leadSource,
    advance_pct: row.advancePct,
    retention_pct: row.retentionPct,
    notes: row.notes,
    active: row.active,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}
