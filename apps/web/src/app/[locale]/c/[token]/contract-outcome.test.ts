import { describe, expect, it } from 'vitest';
import { messageAt } from '@/test/render-with-intl';
import { contractDecidedKey } from './contract-outcome';

// A3 F3: a contract the studio recorded as signed on paper is never thanked for
// an acknowledgement the client did not make; /c says the day and the way.

describe('contractDecidedKey', () => {
  const paper = { status: 'signed', signed: { on: '2026-10-15', via: 'paper' as const } };
  const online = { status: 'signed', signed: { on: '2026-10-15', via: 'online' as const } };

  it('thanks the client for their own click, and only for it', () => {
    expect(contractDecidedKey({ status: 'issued', signed: null }, 'signed')).toBe('done');
    expect(contractDecidedKey(online, null)).toBe('signedOnline');
  });

  it('says a paper signature as one, with its day, never as the client acknowledgement', () => {
    expect(contractDecidedKey(paper, null)).toBe('signedPaper');
    expect(contractDecidedKey(paper, 'already')).toBe('signedPaper');
    for (const locale of ['en', 'ar-EG'] as const) {
      const sentence = messageAt(locale, 'contracts.ack.signedPaper');
      expect(sentence).toContain('{date}');
      expect(sentence).not.toBe(messageAt(locale, 'contracts.ack.done'));
    }
  });

  it('a signed contract with no signing event says only that it is signed; a closed one keeps its sentence', () => {
    expect(contractDecidedKey({ status: 'signed', signed: null }, null)).toBe('signed');
    expect(contractDecidedKey({ status: 'issued', signed: null }, 'expired')).toBe('expired');
    expect(contractDecidedKey({ status: 'issued', signed: null }, 'already')).toBe('already');
    expect(contractDecidedKey({ status: 'terminated', signed: null }, null)).toBe('already');
  });
});
