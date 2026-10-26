import { describe, expect, it } from 'vitest';
import { contractChip } from './contract-chip';

// H4 follow-up F1: once the online signing window has closed, the contract
// card no longer asks for the client's signature in the your-move tone: the
// move is the studio's, as the hero says.

describe('contractChip', () => {
  it('an issued contract with its signing window open awaits the client, in the your-move tone', () => {
    expect(contractChip({ status: 'issued', signingOpen: true })).toEqual({ key: 'issued', tone: 'yourMove' });
  });

  it('an issued contract whose signing window closed says so, in the studio-move tone', () => {
    expect(contractChip({ status: 'issued', signingOpen: false })).toEqual({ key: 'signingClosed', tone: 'waiting' });
  });

  it('signed and terminated contracts keep their own words', () => {
    expect(contractChip({ status: 'signed', signingOpen: false })).toEqual({ key: 'signed', tone: 'done' });
    expect(contractChip({ status: 'terminated', signingOpen: false })).toEqual({ key: 'terminated', tone: 'neutral' });
  });
});
