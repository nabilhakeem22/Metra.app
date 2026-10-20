import 'server-only';
// What the measurements surfaces read of the contract itself, for a role that
// may measure but not open the contract page (the site engineer, the PM): its
// number, title, client and status, the day it was issued (no reading is
// dated before it) and whether its final account is issued (no reading after
// it). NO MONEY: no value, no total, no price.
import { clients, contracts, type ContractStatus, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { contractIssuedOnInCairo } from '@/lib/contracts/queries/issued-on';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { isFinalAccountIssued } from '../final-account/gate';

export interface MeasurementContractView {
  id: string;
  number: number;
  createdAt: string;
  titleAr: string | null;
  titleEn: string | null;
  clientNameAr: string | null;
  clientNameEn: string | null;
  status: ContractStatus;
  /** `YYYY-MM-DD` in Cairo. */
  issuedOn: string;
  finalAccountIssued: boolean;
}

/** Null when the contract is not the caller's to see (RLS, or no such id) or not an execution contract. */
export async function loadMeasurementContract(tx: MetraDb, contractId: string): Promise<MeasurementContractView | null> {
  const [row] = await tx
    .select({
      id: contracts.id,
      number: contracts.number,
      createdAt: contracts.createdAt,
      titleAr: contracts.titleAr,
      titleEn: contracts.titleEn,
      status: contracts.status,
      sourceBoqId: contracts.sourceBoqId,
      clientNameAr: clients.nameAr,
      clientNameEn: clients.nameEn,
    })
    .from(contracts)
    .leftJoin(clients, eq(clients.id, contracts.clientId))
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!row || row.sourceBoqId === null) return null;
  const { sourceBoqId: _execution, createdAt, ...header } = row;
  return {
    ...header,
    createdAt: createdAt.toISOString(),
    issuedOn: await contractIssuedOnInCairo(tx, contractId),
    finalAccountIssued: await isFinalAccountIssued(tx, contractId),
  };
}

/** The measurements page's header, in its own org transaction. */
export function getMeasurementContract(ctx: OrgContext, contractId: string): Promise<MeasurementContractView | null> {
  return withOrgContext(ctx, (tx) => loadMeasurementContract(tx, contractId));
}
