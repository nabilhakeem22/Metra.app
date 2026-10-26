import { describe, expect, it, vi } from 'vitest';
import { CLIENT_EXECUTION_REASONS } from '@/lib/flow/locate/execution-client';
import { CONTRACT_ID, homePayload } from '@/test/client-home-payloads';

// The fact source's derivation reads the schedule module, which is server-only.
vi.mock('server-only', () => ({}));

const { shapeHome } = await import('./shape');

// The home's payload is UNTRUSTED: a malformed delivery or contract answers
// null, no key is copied through, and the studio's fact source is turned into
// where the client stands and then dropped (H3 ruling D2).

describe('shapeHome', () => {
  it('maps the payload onto the browser shape, the fact source reduced to the client location', () => {
    const home = shapeHome(homePayload('sign_contract'));
    expect(home).toEqual({
      delivery: { documentNumber: 'DE-2026-0012', titleAr: 'فيلا الشريف', titleEn: 'El Sherif Villa', entryPhase: 'design', phase: 'execution' },
      firm: { nameAr: 'استوديو نون', nameEn: 'Noon Studio', hasLogo: false, phone: '+201000000001', whatsappDigits: '201000000002' },
      client: { nameAr: 'هشام الشريف', nameEn: 'Hesham El Sherif' },
      codeChannel: { hint: 'h•••@e•••.com' },
      execution: {
        contract: {
          id: CONTRACT_ID,
          documentNumber: 'C-2026-0004',
          status: 'issued',
          signingOpen: true,
          signed: null,
          revisedFinish: '2027-03-14',
          terminatedAt: null,
        },
        previousContractTerminatedAt: null,
        openVariationCount: 0,
        lapsedVariationCount: 0,
        location: { step: 'signature', whoseMove: 'client', status: 'active', reason: 'sign_contract' },
        money: expect.objectContaining({ contract: expect.objectContaining({ documentNumber: 'C-2026-0004' }) }),
      },
    });
  });

  it('never carries a key of the fact source to the browser', () => {
    for (const reason of CLIENT_EXECUTION_REASONS) {
      const shown = JSON.stringify(shapeHome(homePayload(reason)));
      expect({ reason, leaks: /flow_source|flowSource|supervision|original_value|tax_rate|billingBalance|issued_boq/i.test(shown) }).toEqual({
        reason,
        leaks: false,
      });
    }
  });

  it('places every client reason from its fact source', () => {
    for (const reason of CLIENT_EXECUTION_REASONS) {
      expect({ reason, located: shapeHome(homePayload(reason))?.execution?.location.reason }).toEqual({ reason, located: reason });
    }
  });

  it('counts the change orders the client can answer and the lapsed ones apart', () => {
    const payload = homePayload('decide_change_order');
    const execution = payload.execution as { flow_source: { contract: { money: Record<string, number> } } };
    Object.assign(execution.flow_source.contract.money, { open_variations: 3, issued_variations: 1, expired_variations: 2 });
    expect(shapeHome(payload)?.execution).toMatchObject({ openVariationCount: 1, lapsedVariationCount: 2 });
  });

  it('a delivery in design has no execution block; no address on file has no code channel', () => {
    const payload = homePayload('works_in_progress', { codeChannel: null });
    Object.assign(payload.delivery as object, { phase: 'design' });
    expect(shapeHome(payload)).toMatchObject({ execution: null, codeChannel: null, delivery: { phase: 'design' } });
  });

  it('answers null for a payload this build cannot show', () => {
    const broken: Array<(payload: Record<string, unknown>) => void> = [
      (payload) => Object.assign(payload, { delivery: null }),
      (payload) => Object.assign(payload.delivery as object, { number: 0 }),
      (payload) => Object.assign(payload.delivery as object, { entry_phase: 'site' }),
      (payload) => Object.assign(payload.delivery as object, { phase: 'execution_decision' }),
      (payload) => Object.assign((payload.execution as Record<string, object>).contract, { status: 'draft' }),
      (payload) => Object.assign((payload.execution as Record<string, object>).contract, { id: 'not-a-uuid' }),
      (payload) => Object.assign((payload.execution as Record<string, object>).contract, { time_extension_days_total: -1 }),
    ];
    for (const [index, corrupt] of broken.entries()) {
      const payload = homePayload('sign_contract');
      corrupt(payload);
      expect({ index, home: shapeHome(payload) }).toEqual({ index, home: null });
    }
    expect(shapeHome(null)).toBeNull();
    expect(shapeHome([])).toBeNull();
  });

  it('throws on facts no query can produce, so the reader answers read_failed', () => {
    const payload = homePayload('pay_request');
    const execution = payload.execution as { flow_source: { contract: { money: Record<string, number> } } };
    Object.assign(execution.flow_source.contract.money, { unclaimed_due_requests: 2 });
    expect(() => shapeHome(payload)).toThrow();
  });

  it('keeps a signature, a termination and a terminated earlier contract, and drops a malformed signature', () => {
    const terminated = homePayload('terminated');
    Object.assign(terminated.execution as object, { previous_contract: { status: 'terminated', terminated_at: '2026-09-01T10:00:00Z' } });
    expect(shapeHome(terminated)?.execution).toMatchObject({
      contract: { status: 'terminated', signed: { on: '2026-10-03', via: 'online' }, terminatedAt: '2026-10-25T10:00:00.000Z' },
      previousContractTerminatedAt: '2026-09-01T10:00:00.000Z',
      location: { reason: 'terminated', status: 'closed', step: null },
    });
    const odd = homePayload('works_in_progress');
    Object.assign((odd.execution as Record<string, object>).contract, { signed: { on: '2026-10-03', via: 'fax' } });
    expect(shapeHome(odd)?.execution?.contract?.signed).toBeNull();
  });
});
