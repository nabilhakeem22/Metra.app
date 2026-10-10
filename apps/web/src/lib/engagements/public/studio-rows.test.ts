import { describe, expect, it } from 'vitest';
import { shapeDelivery } from './delivery-shape';
import type { DeliverySnapshot } from './row-guards';
import { parseFirm, parsePaymentDetails } from './studio-rows';

// Round C (tasks 40, 47): the studio's contact and payment instructions, read
// off an untrusted snapshot. The logo id never crosses; the instructions show
// only while a milestone is claimable and a usable method is set.

type ClaimRows = NonNullable<NonNullable<DeliverySnapshot['claim']>['claimable_milestones']>;

const LOGO = '11111111-1111-4111-8111-111111111111';
const DETAILS = {
  instapay: 'studio@instapay',
  bank_name: 'CIB',
  bank_account_holder: 'Studio LLC',
  bank_account_number: '100023456789',
  bank_iban: 'EG380019000500000000263180002',
};

describe('parseFirm', () => {
  it('says whether a logo exists without forwarding its id, and builds the WhatsApp digits', () => {
    const firm = parseFirm({ name_ar: 'ديوان', name_en: 'Diwan', logo_file_id: LOGO, phone: '+201012345678', whatsapp: '01112345678' });
    expect(firm).toEqual({ nameAr: 'ديوان', nameEn: 'Diwan', hasLogo: true, phone: '+201012345678', whatsappDigits: '201112345678' });
    expect(JSON.stringify(firm)).not.toContain(LOGO);
  });

  it('falls back to the phone for WhatsApp, and drops numbers the CHECK would not allow', () => {
    expect(parseFirm({ phone: '01012345678' }).whatsappDigits).toBe('201012345678');
    expect(parseFirm({ phone: '010 1234 5678', whatsapp: 'tel:1' })).toMatchObject({ phone: null, whatsappDigits: null });
    expect(parseFirm({ phone: 'javascript:alert(1)' }).phone).toBeNull();
    expect(parseFirm({ logo_file_id: 'not-a-uuid' }).hasLogo).toBe(false);
    expect(parseFirm(null)).toEqual({ nameAr: null, nameEn: null, hasLogo: false, phone: null, whatsappDigits: null });
  });
});

describe('parsePaymentDetails (AC 47)', () => {
  it('maps the five values while a milestone is claimable', () => {
    expect(parsePaymentDetails(DETAILS, 1)).toEqual({
      instapay: 'studio@instapay',
      bankName: 'CIB',
      bankAccountHolder: 'Studio LLC',
      bankAccountNumber: '100023456789',
      bankIban: 'EG380019000500000000263180002',
    });
  });

  it('prints Latin digits only, whatever the studio typed (§4.1)', () => {
    expect(parsePaymentDetails({ instapay: ' ٠١٠١٢٣٤٥٦٧٨ ' }, 1)!.instapay).toBe('01012345678');
  });

  it('is null when nothing is claimable, when every field is empty, or with no usable method', () => {
    expect(parsePaymentDetails(DETAILS, 0)).toBeNull();
    expect(parsePaymentDetails({ instapay: '  ', bank_name: '', bank_iban: null }, 1)).toBeNull();
    expect(parsePaymentDetails({ bank_name: 'CIB', bank_account_holder: 'Studio LLC' }, 1)).toBeNull();
    expect(parsePaymentDetails('nope', 1)).toBeNull();
    expect(parsePaymentDetails({ instapay: 42 }, 1)).toBeNull();
  });
});

describe('the mapped delivery (AC 47)', () => {
  const base = { id: 'de-1', number: 3, state: 'concept_review', payment_details: DETAILS };
  const claim = (rows: ClaimRows) => ({ claim: { claimable_milestones: rows } });
  const due = { milestone_kind: 'deposit', amount_remaining: '30000.0000', has_pending_claim: false, claimed_at: null };

  it('carries the instructions only while a milestone is claimable', () => {
    expect(shapeDelivery({ ...base, ...claim([due]) })!.paymentDetails).not.toBeNull();
    expect(shapeDelivery({ ...base, ...claim([]) })!.paymentDetails).toBeNull();
    expect(shapeDelivery(base)!.paymentDetails).toBeNull();
  });

  it('dates only an OPEN claim', () => {
    const pending = { ...due, has_pending_claim: true, claimed_at: '2026-10-01T09:00:00+03:00' };
    const [row] = shapeDelivery({ ...base, ...claim([pending]) })!.paymentClaim!.claimableMilestones;
    expect(row.claimedAt).toBe('2026-10-01T06:00:00.000Z');
    const [stale] = shapeDelivery({ ...base, ...claim([{ ...pending, has_pending_claim: false }]) })!.paymentClaim!.claimableMilestones;
    expect(stale.claimedAt).toBeNull();
  });

  it('reads the decisions on file and the expected day, dropping malformed ones', () => {
    const delivery = shapeDelivery({
      ...base,
      expected_on: '2026-10-20',
      design_decision: { kind: 'approved', at: '2026-10-01T09:00:00Z' },
      handover_acknowledged_at: 'yesterday',
      rom_acknowledged_at: '2026-10-02T09:00:00Z',
      timeline: [{ type: 'stage', state: 'concept_review', at: '2026-10-03T09:00:00Z' }],
      documents: [{ id: 'doc-1', kind: 'approved_render', shared_at: '2026-10-04T09:00:00Z', media: 'image' }],
    })!;
    expect(delivery.expectedOn).toBe('2026-10-20');
    expect(delivery.designDecision).toEqual({ kind: 'approved', at: '2026-10-01T09:00:00.000Z' });
    expect(delivery.handoverAcknowledgedAt).toBeNull();
    expect(delivery.romAcknowledgedAt).toBe('2026-10-02T09:00:00.000Z');
    expect(delivery.lastUpdateAt).toBe('2026-10-04T09:00:00.000Z');
    expect(delivery.documents[0].media).toBe('image');
    const junk = shapeDelivery({ ...base, expected_on: '2026-02-30', design_decision: { kind: 'maybe', at: '2026-10-01T09:00:00Z' } })!;
    expect([junk.expectedOn, junk.designDecision, junk.lastUpdateAt]).toEqual([null, null, null]);
  });
});
