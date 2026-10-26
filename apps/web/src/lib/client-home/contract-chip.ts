// The Execution tab's contract card: the chip that says where the contract
// stands FOR THE CLIENT, and in whose tone. PURE and CLIENT-SAFE.
import type { StatusTone } from '@/lib/ui/status-tone';
import type { HomeContract } from './types';

/** The chip's words under `delivery.contract.status`. */
type ContractChipKey = HomeContract['status'] | 'signingClosed';

/**
 * An issued contract waits for the client's signature only while its online
 * signing window is open; once it has closed, the move is the studio's (the
 * hero says so too), so the chip says signing closed in the studio's tone.
 */
export function contractChip(contract: Pick<HomeContract, 'status' | 'signingOpen'>): { key: ContractChipKey; tone: StatusTone } {
  if (contract.status === 'issued') return contract.signingOpen ? { key: 'issued', tone: 'yourMove' } : { key: 'signingClosed', tone: 'waiting' };
  return contract.status === 'signed' ? { key: 'signed', tone: 'done' } : { key: 'terminated', tone: 'neutral' };
}
