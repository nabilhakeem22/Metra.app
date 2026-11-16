// A change order's token document as the client's pages read it. PURE: /v's
// reader (./public.ts) and the client home's (lib/client-home/variations.ts)
// map the same JSON with this one function.
import { validIsoDate } from '@/lib/validation/iso-date';
import type { PublicVariation, VariationTokenDocument } from './public-types';

/** A rate as the SDF sends it: a plain non-negative decimal string. */
const RATE_TEXT = /^\d+(\.\d+)?$/;

/**
 * The recorded rejection channel, or null, mapped DEFENSIVELY, exactly as
 * `contract_active` is: anything that is not the string 'client' or 'staff'
 * becomes null, including the `undefined` an un-applied function returns. null
 * then falls through the decided-message ladder to today's wording, so an app
 * that knows this field can read a database that does not yet write it.
 */
function toRejectionChannel(value: unknown): 'client' | 'staff' | null {
  return value === 'client' || value === 'staff' ? value : null;
}

/**
 * The rates the breakdown is computed with, or null, mapped DEFENSIVELY like
 * the channel: only a BOQ contract's order with two well-formed rates gets a
 * breakdown, so a document from an un-applied function keeps today's page.
 */
function toCharges(source: unknown, taxRate: unknown, supervisionPct: unknown): PublicVariation['charges'] {
  if (source !== 'boq' || typeof taxRate !== 'string' || typeof supervisionPct !== 'string') return null;
  return RATE_TEXT.test(taxRate) && RATE_TEXT.test(supervisionPct) ? { taxRate, supervisionPct } : null;
}

/**
 * A BOQ contract's whole, non-negative day count, or null for anything else: a
 * proposal contract's order carries no days in the studio, so none here (F6).
 */
function toExtensionDays(source: unknown, value: unknown): number | null {
  if (source !== 'boq') return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * A BOQ contract's end date and approved days, or null: a proposal contract's
 * order says no finish, and a document without the total (an un-applied
 * function) keeps today's page.
 */
function toFinish(source: unknown, endDate: unknown, total: unknown): PublicVariation['finish'] {
  if (source !== 'boq') return null;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return null;
  const day = typeof endDate === 'string' && validIsoDate(endDate) ? endDate : null;
  return { endDate: day, approvedExtensionDays: total };
}

/** 'boq' only when the document says so: a document from an un-applied function reads as a proposal, today's page. */
export function contractSourceOf(value: unknown): 'boq' | 'proposal' {
  return value === 'boq' ? 'boq' : 'proposal';
}

export function publicVariationOf(document: VariationTokenDocument): PublicVariation {
  const {
    contract_active: contractActive,
    rejection_channel: rejectionChannel,
    tax_rate: taxRate,
    supervision_pct: supervisionPct,
    time_extension_days: timeExtensionDays,
    contract_source: contractSource,
    contract_end_date: contractEndDate,
    time_extension_days_total: approvedExtensionDays,
    ...rest
  } = document;
  // Only an explicit false marks the contract dead. The respond SDF is the real
  // gate, so a document from an un-applied function must not black out the portal.
  return {
    ...rest,
    contractActive: contractActive !== false,
    contractSource: contractSourceOf(contractSource),
    rejectionChannel: toRejectionChannel(rejectionChannel),
    charges: toCharges(contractSource, taxRate, supervisionPct),
    timeExtensionDays: toExtensionDays(contractSource, timeExtensionDays),
    finish: toFinish(contractSource, contractEndDate, approvedExtensionDays),
  };
}
