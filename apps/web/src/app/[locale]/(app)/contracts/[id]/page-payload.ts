// What the contract page hands its client component (A4 security S1). PLAIN
// module (NOT 'use client'), so the server page and its test both import it.
//
// Everything passed to a 'use client' component is serialised into the page's
// flight data, readable by whoever opens the page. A project manager or an
// accountant has no `contracts_generate` read (they see the Payments tab
// alone), so for them the page passes the SLIM header the tab strip and the
// tab need, and nothing of the contract itself: no client, no terms, no scope,
// no penalty, no money. The full detail goes only to roles that read the
// contract.
import type { ContractStatus } from '@metra/db';
import type { ContractPageDetail } from '@/lib/contracts/queries';

/** The contract as every role on its page may see it. */
export interface ContractPageHeader {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ContractStatus;
  sourceBoqId: string | null;
  createdAt: string;
}

export interface ContractPagePayload {
  header: ContractPageHeader;
  /** The whole contract; null for a role that only reads its payments. */
  detail: ContractPageDetail | null;
}

export function contractPagePayload(detail: ContractPageDetail, access: { seeContract: boolean }): ContractPagePayload {
  const header: ContractPageHeader = {
    id: detail.id,
    number: detail.number,
    titleAr: detail.titleAr,
    titleEn: detail.titleEn,
    status: detail.status,
    sourceBoqId: detail.sourceBoqId,
    createdAt: detail.createdAt,
  };
  return { header, detail: access.seeContract ? detail : null };
}
