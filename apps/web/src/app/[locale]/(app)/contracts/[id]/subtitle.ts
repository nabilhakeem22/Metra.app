// What the contract page says under its number: where the contract stands now,
// not how it began. SERVER-SAFE and PURE.
import type { ContractStatus } from '@metra/db';
import type { ExecutionStage } from '@/lib/execution/stage';

export const CONTRACT_SUBTITLES = [
  'draftProposal',
  'draftBoq',
  'issued',
  'signed',
  'finalAccount',
  'settled',
  'terminated',
] as const;

export type ContractSubtitle = (typeof CONTRACT_SUBTITLES)[number];

/**
 * A draft says where it came from and what issuing it does; an issued or a
 * terminated contract says so. A signed execution contract is told by its
 * stage (`stage`, from lib/execution/stage.ts): its final account issued, or
 * settled, or the work under way. A proposal contract has no stage (null).
 */
export function contractSubtitle(
  contract: { status: ContractStatus; sourceBoqId: string | null },
  stage: ExecutionStage | null,
): ContractSubtitle {
  switch (contract.status) {
    case 'draft':
      return contract.sourceBoqId === null ? 'draftProposal' : 'draftBoq';
    case 'issued':
      return 'issued';
    case 'terminated':
      return 'terminated';
    case 'signed':
      if (stage === 'final_account') return 'finalAccount';
      if (stage === 'settled') return 'settled';
      return 'signed';
  }
}
