import 'server-only';
// Public (no-session) client home, the CONTRACT's document: the home's
// execution contract read through the H3 token SDFs (app_home_contract_*), each
// of which calls the /c function with the contract's stored hash, so what the
// home shows is /c's own JSON (AC2). Through lib/share/sdf-call (NO
// withOrgContext, NO org GUCs: the token IS the auth); the raw token is hashed
// here and never logged. Each read is made only when the client asks for it:
// the document when it is opened, more sections and a section's lines when
// shown (the Workers CPU budget). Signing reads the same snapshot, with the
// page and before the act (./contract-signing.ts).
import { sql } from 'drizzle-orm';
import { isLineOffset, isSectionOffset } from '@/lib/contracts/public';
import type {
  ContractDocument,
  PublicContract,
  PublicSectionLinesPage,
  PublicSectionsPage,
} from '@/lib/contracts/public-types';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';

/** The part of the snapshot the document shows; the rest (terms, digest, studio) stays on the server. */
export function contractDocumentOf(contract: PublicContract): ContractDocument {
  return {
    id: contract.id,
    source: contract.source,
    discount_pct: contract.discount_pct,
    discount_amount: contract.discount_amount,
    taxable_base: contract.taxable_base,
    tax_rate: contract.tax_rate,
    tax_amount: contract.tax_amount,
    supervision_pct: contract.supervision_pct,
    supervision_amount: contract.supervision_amount,
    original_value: contract.original_value,
    total: contract.total,
    advance_pct: contract.advance_pct,
    retention_pct: contract.retention_pct,
    payment_schedule: contract.payment_schedule,
    section_count: contract.section_count,
    sections: contract.sections,
  };
}

/**
 * The home's whole contract snapshot, /c's JSON. Null, uniformly, for a blank,
 * unknown, revoked or expired link, a delivery not at execution, and a
 * contract that is not issued or signed.
 */
async function readHomeContractSnapshot(rawToken: string): Promise<PublicContract | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  return readSdfJson<PublicContract>(sql`select public.app_home_contract_by_token(${hashShareToken(token)}) as data`);
}

/** The snapshot when it IS the contract named (ids compared lower case), else null: never another contract's. */
export async function readNamedContractSnapshot(rawToken: string, contractId: string): Promise<PublicContract | null> {
  const contract = await readHomeContractSnapshot(rawToken);
  return contract !== null && contract.id === contractId.toLowerCase() ? contract : null;
}

/** The home's contract document, opening as /c opens (its first 50 sections, holding its first 50 lines); null as the snapshot. */
export async function getHomeContract(rawToken: string): Promise<ContractDocument | null> {
  const contract = await readHomeContractSnapshot(rawToken);
  return contract && contractDocumentOf(contract);
}

/** A contract id as the browser hands it back: a uuid string, or nothing to read with. */
function isContractId(contractId: unknown): contractId is string {
  return typeof contractId === 'string' && isUuid(contractId);
}

/**
 * Up to 50 sections of the home's contract from `offset`, collapsed. Bound to
 * the contract the document was opened on (`contractId`, DB step D): null when
 * the home's contract is now another one, as for the document, or for an
 * offset out of range.
 */
export async function getHomeContractSections(
  rawToken: string,
  contractId: unknown,
  offset: unknown,
): Promise<PublicSectionsPage | null> {
  const token = normalizeRawToken(rawToken);
  if (!token || !isContractId(contractId) || !isSectionOffset(offset)) return null;
  return readSdfJson<PublicSectionsPage>(
    sql`select public.app_home_contract_sections_by_token(${hashShareToken(token)}, ${contractId}::uuid, ${offset}::int) as data`,
  );
}

/**
 * Up to 100 lines of one section of the home's contract, from `offset`. Null
 * as for the sections, and for a section that is not one of THAT contract's
 * (no oracle about other contracts).
 */
export async function getHomeContractSectionLines(
  rawToken: string,
  contractId: unknown,
  sectionId: unknown,
  offset: unknown,
): Promise<PublicSectionLinesPage | null> {
  const token = normalizeRawToken(rawToken);
  if (!token || !isContractId(contractId) || typeof sectionId !== 'string' || !isUuid(sectionId) || !isLineOffset(offset)) {
    return null;
  }
  return readSdfJson<PublicSectionLinesPage>(
    sql`select public.app_home_contract_section_lines_by_token(${hashShareToken(token)}, ${contractId}::uuid, ${sectionId}::uuid, ${offset}::int) as data`,
  );
}
