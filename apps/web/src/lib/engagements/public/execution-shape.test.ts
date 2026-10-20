import { describe, expect, it } from 'vitest';
import { shapeExecution } from './execution-shape';

// The execution card's snapshot is UNTRUSTED, like the delivery's: a malformed
// row is dropped, a malformed contract drops the card, no key is copied
// through, and the lists are cut at the SQL's own cap.

const CONTRACT = { number: 7, year: 2026, status: 'signed', title_ar: null, title_en: 'Villa', original_value: '124000.0000' };
const REQUEST = {
  id: 'r-1', number: 4, year: 2026, kind: 'milestone', label_ar: null, label_en: 'Advance',
  variation_number: null, variation_year: null, amount: '62000.0000', issued_on: '2026-11-01', due_on: null,
  paid: '0.0000', outstanding: '62000.0000', status: 'issued', has_pending_claim: false, claimed_at: null,
};
const DETAILS = { instapay: 'studio@instapay', bank_name: null, bank_account_holder: null, bank_account_number: null, bank_iban: null };

const snapshot = (over: Record<string, unknown> = {}) => ({
  contract: CONTRACT,
  requests: [REQUEST],
  requests_truncated: false,
  receipts: [{ amount: '100.0000', received_on: '2026-11-02', request_number: 4, request_year: 2026 }],
  receipts_truncated: false,
  payment_details: DETAILS,
  ...over,
});

describe('shapeExecution', () => {
  it('maps the snapshot onto the browser shape, numbers formatted', () => {
    expect(shapeExecution(snapshot())).toEqual({
      contract: { documentNumber: 'C-2026-0007', status: 'signed', titleAr: null, titleEn: 'Villa', originalValue: '124000.0000' },
      requests: [
        {
          id: 'r-1', documentNumber: 'PR-2026-0004', target: { kind: 'milestone', labelAr: null, labelEn: 'Advance' },
          amount: '62000.0000', paid: '0.0000', outstanding: '62000.0000', issuedOn: '2026-11-01', dueOn: null,
          void: false, claimedAt: null,
        },
      ],
      requestsTruncated: false,
      receipts: [{ amount: '100.0000', receivedOn: '2026-11-02', requestNumber: 'PR-2026-0004' }],
      receiptsTruncated: false,
      earlierClaims: [],
      paymentDetails: { instapay: 'studio@instapay', bankName: null, bankAccountHolder: null, bankAccountNumber: null, bankIban: null },
    });
  });

  it("carries the claims still waiting on the delivery's other contracts, malformed ones dropped, at most 10 (B4 F6)", () => {
    const claim = { request_number: 3, request_year: 2026, amount: '60000.0000', claimed_at: '2026-11-03T09:15:00.123456+00:00' };
    const card = shapeExecution(snapshot({
      earlier_claims: [claim, { ...claim, amount: '0' }, { ...claim, claimed_at: 'yesterday' }, null, ...Array.from({ length: 12 }, () => claim)],
    }));
    expect(card?.earlierClaims[0]).toEqual({ requestNumber: 'PR-2026-0003', amount: '60000.0000', claimedAt: '2026-11-03T09:15:00.123Z' });
    expect(card?.earlierClaims).toHaveLength(7);
    expect(shapeExecution(snapshot({ earlier_claims: 'nope' }))?.earlierClaims).toEqual([]);
  });

  it('names a change order by its number and the final account by its kind', () => {
    const card = shapeExecution(snapshot({
      requests: [
        { ...REQUEST, id: 'v', kind: 'variation', variation_number: 2, variation_year: 2026 },
        { ...REQUEST, id: 'f', kind: 'final_account' },
      ],
    }));
    expect(card?.requests.map((row) => row.target)).toEqual([
      { kind: 'variation', documentNumber: 'VO-2026-0002' },
      { kind: 'final_account' },
    ]);
  });

  it('drops a malformed row, and the card when the contract is malformed', () => {
    const card = shapeExecution(snapshot({
      requests: [REQUEST, { ...REQUEST, amount: '-1' }, { ...REQUEST, status: 'draft' }, { ...REQUEST, kind: 'other' }, null],
      receipts: [{ amount: '1', received_on: 'yesterday', request_number: 4, request_year: 2026 }],
    }));
    expect(card?.requests).toHaveLength(1);
    expect(card?.receipts).toEqual([]);
    for (const contract of [null, { ...CONTRACT, status: 'draft' }, { ...CONTRACT, number: 0 }, { ...CONTRACT, original_value: 'x' }]) {
      expect(shapeExecution(snapshot({ contract }))).toBeNull();
    }
    expect(shapeExecution(null)).toBeNull();
    expect(shapeExecution([])).toBeNull();
  });

  it('copies no key it does not name, and says a claim only while one waits', () => {
    const card = shapeExecution(snapshot({
      requests: [{ ...REQUEST, unit_cost: '9', claimed_at: '2026-11-05T10:00:00+02:00' }],
      line_margin: '1',
    }));
    expect(JSON.stringify(card)).not.toMatch(/cost|margin/);
    expect(card?.requests[0].claimedAt).toBeNull();
    const waiting = shapeExecution(snapshot({ requests: [{ ...REQUEST, has_pending_claim: true, claimed_at: '2026-11-05T10:00:00+02:00' }] }));
    expect(waiting?.requests[0].claimedAt).toBe('2026-11-05T08:00:00.000Z');
  });

  it('cuts each list at 60 and keeps the truncated flags; no usable method is no instructions', () => {
    const card = shapeExecution(snapshot({
      requests: Array.from({ length: 70 }, (_, n) => ({ ...REQUEST, id: `r-${n}` })),
      requests_truncated: true,
      payment_details: { ...DETAILS, instapay: null, bank_account_holder: 'Studio' },
    }));
    expect(card?.requests).toHaveLength(60);
    expect(card?.requestsTruncated).toBe(true);
    expect(card?.paymentDetails).toBeNull();
  });
});
