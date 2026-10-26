import { describe, expect, it, vi } from 'vitest';
import type { PortalExecutionRequest } from '@/lib/engagements/public/execution-types';
import { CLIENT_EXECUTION_REASONS } from '@/lib/flow/locate/execution-client';
import { homePayload } from '@/test/client-home-payloads';
import { clientMoveKey, clientMoveTone, heroAct, heroRequest } from './hero';
import type { HomeExecution } from './types';

vi.mock('server-only', () => ({}));

const { shapeHome } = await import('./shape');

const executionOf = (reason: (typeof CLIENT_EXECUTION_REASONS)[number]): HomeExecution => {
  const execution = shapeHome(homePayload(reason))?.execution;
  if (!execution) throw new Error(reason);
  return execution;
};

const request = (id: string, fields: Partial<PortalExecutionRequest> = {}): PortalExecutionRequest => ({
  id,
  documentNumber: `PR-2026-000${id}`,
  target: { kind: 'milestone', labelAr: null, labelEn: 'Instalment' },
  amount: '100.0000',
  paid: '0.0000',
  outstanding: '100.0000',
  issuedOn: '2026-10-01',
  dueOn: null,
  void: false,
  claimedAt: null,
  ...fields,
});

describe('heroRequest', () => {
  it('names the OLDEST request still due and unclaimed when the client is asked to pay', () => {
    const execution = executionOf('pay_request');
    const money = execution.money;
    if (!money) throw new Error('no money');
    const requests = [request('3'), request('2', { claimedAt: '2026-10-02T00:00:00.000Z' }), request('1'), request('0', { void: true })];
    expect(heroRequest({ ...execution, money: { ...money, requests } })?.id).toBe('1');
  });

  it('names the final account once it is due, and the newest pending claim while the studio checks', () => {
    expect(heroRequest(executionOf('final_account_due'))?.target.kind).toBe('final_account');
    expect(heroRequest(executionOf('payment_being_confirmed'))?.claimedAt).not.toBeNull();
    expect(heroRequest(executionOf('works_in_progress'))).toBeNull();
  });

  it('names none when the list holds no such request', () => {
    const execution = executionOf('pay_request');
    if (!execution.money) throw new Error('no money');
    expect(heroRequest({ ...execution, money: { ...execution.money, requests: [] } })).toBeNull();
  });
});

describe('the client side of whose move it is', () => {
  it('the client move is the brand "your move"; the studio and the site wait; the ends are done or neutral', () => {
    const tones = Object.fromEntries(CLIENT_EXECUTION_REASONS.map((reason) => [reason, clientMoveTone(executionOf(reason).location)]));
    expect(tones).toEqual({
      preparing_contract: 'waiting',
      sign_contract: 'yourMove',
      signing_closed: 'waiting',
      decide_change_order: 'yourMove',
      pay_request: 'yourMove',
      payment_being_confirmed: 'waiting',
      works_in_progress: 'waiting',
      final_account_due: 'yourMove',
      final_account_in_review: 'waiting',
      settled: 'done',
      terminated: 'neutral',
    });
    expect(clientMoveKey(executionOf('works_in_progress').location)).toBe('site');
    expect(clientMoveKey(executionOf('settled').location)).toBe('done');
    expect(clientMoveKey(executionOf('terminated').location)).toBe('closed');
  });

  it('offers an act only on the client move, and WhatsApp when only the studio can help', () => {
    expect(heroAct('signing_closed')).toEqual({ kind: 'whatsapp' });
    for (const reason of CLIENT_EXECUTION_REASONS) {
      const act = heroAct(reason);
      if (act?.kind === 'section') expect({ reason, move: executionOf(reason).location.whoseMove }).toEqual({ reason, move: 'client' });
    }
  });
});
