import { describe, expect, it, vi } from 'vitest';

// H6.2 re-check N2: the studio reads the signer's name as signerNameOf reads
// it. /c stored a name with only a trim, so a bidi override, a bare isolate
// close or invisible characters must not reach the studio's line, and a name
// with nothing visible left reads as no name.

vi.mock('server-only', () => ({}));

import type { MetraDb } from '@metra/db';
import { loadContractSigning } from './signing';

const txAnswering = (rows: unknown[]) => ({ execute: async () => rows }) as unknown as MetraDb;
const online = (signerName: string | null) => [{ on: '2026-10-25', via: 'online', signerName }];

describe('loadContractSigning: the signer name the studio sees', () => {
  it('is cleaned to one line with no bidi control', async () => {
    expect(await loadContractSigning(txAnswering(online('Eve⁩‮Hesham\nEl-Sherif')), 'c-1')).toEqual({
      on: '2026-10-25',
      via: 'online',
      signerName: 'Eve Hesham El-Sherif',
    });
  });

  it('is null when nothing visible is left, or none was typed (the no-name sentence)', async () => {
    for (const name of ['​​', 'ــ', null]) {
      expect((await loadContractSigning(txAnswering(online(name)), 'c-1'))?.signerName).toBeNull();
    }
  });

  it('a paper signature, and no signing at all, as before', async () => {
    expect(await loadContractSigning(txAnswering([{ on: '2026-10-25', via: 'paper', signerName: null }]), 'c-1')).toEqual({
      on: '2026-10-25',
      via: 'paper',
      signerName: null,
    });
    expect(await loadContractSigning(txAnswering([]), 'c-1')).toBeNull();
  });
});
