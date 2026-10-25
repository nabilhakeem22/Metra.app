import { describe, expect, it } from 'vitest';
import { messageAt } from '@/test/render-with-intl';
import { CONTRACT_SUBTITLES, contractSubtitle } from './subtitle';

const BOQ = 'b-1';

describe('the contract page subtitle says where the contract stands', () => {
  it('a draft says where it came from', () => {
    expect(contractSubtitle({ status: 'draft', sourceBoqId: null }, null)).toBe('draftProposal');
    expect(contractSubtitle({ status: 'draft', sourceBoqId: BOQ }, 'draft')).toBe('draftBoq');
  });

  it('an issued and a terminated contract say so, whatever they came from', () => {
    expect(contractSubtitle({ status: 'issued', sourceBoqId: BOQ }, 'awaiting_signature')).toBe('issued');
    expect(contractSubtitle({ status: 'issued', sourceBoqId: null }, null)).toBe('issued');
    expect(contractSubtitle({ status: 'terminated', sourceBoqId: BOQ }, 'terminated')).toBe('terminated');
  });

  it('a signed execution contract follows its stage; a signed proposal contract is signed', () => {
    expect(contractSubtitle({ status: 'signed', sourceBoqId: BOQ }, 'in_progress')).toBe('signed');
    expect(contractSubtitle({ status: 'signed', sourceBoqId: BOQ }, 'final_account')).toBe('finalAccount');
    expect(contractSubtitle({ status: 'signed', sourceBoqId: BOQ }, 'settled')).toBe('settled');
    expect(contractSubtitle({ status: 'signed', sourceBoqId: null }, null)).toBe('signed');
  });

  it('only a draft offers electronic acknowledgement, in both languages', () => {
    for (const locale of ['en', 'ar-EG'] as const) {
      const drafts = new Set(['draftProposal', 'draftBoq']);
      const issueWords = messageAt(locale, 'contracts.detailSubtitle.draftBoq').split(/[.،]/)[1].trim();
      for (const key of CONTRACT_SUBTITLES) {
        const text = messageAt(locale, `contracts.detailSubtitle.${key}`);
        expect(text.length, key).toBeGreaterThan(0);
        if (!drafts.has(key)) expect(text.includes(issueWords), `${locale} ${key}`).toBe(false);
      }
    }
  });
});
