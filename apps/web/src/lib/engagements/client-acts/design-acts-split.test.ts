import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryActionResult } from '../public';
import type { ClientAct } from './acts';

// Round D, owner decision 2 (unit layer of AC S1 to S8): two guarded writes,
// the budget first, each naming its own issuance. `budget: pending` only when
// the band changed; a dead link or a thrown budget stops; no read first.

vi.mock('server-only', () => ({}));

const calls = vi.hoisted(() => ({ log: [] as string[] }));
const respond = vi.hoisted(() => ({
  answers: {} as Record<string, DeliveryActionResult | Error>,
  inputs: [] as Array<{ action: string; expectedIssueAt: string | null; note?: string | null }>,
}));
vi.mock('../public', () => ({
  recordDeliveryActionByToken: async (_token: string, input: { action: string; expectedIssueAt: string | null }) => {
    calls.log.push(`write:${input.action}`);
    respond.inputs.push(input);
    const answer = respond.answers[input.action] ?? { ok: true };
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));
const notified = vi.hoisted(() => ({ acts: [] as ClientAct[] }));
vi.mock('./notify', () => ({
  withStudioNotified: async (_token: string, result: { ok: boolean }, act: ClientAct) => {
    calls.log.push(`notify:${act.kind}`);
    if (result.ok) notified.acts.push(act);
    return { ...result, studioNotified: result.ok };
  },
}));
const saved = vi.hoisted(() => ({ delivery: null as unknown }));
vi.mock('./saved-delivery', () => ({ savedDelivery: async () => (calls.log.push('read'), saved.delivery) }));

const { approveDesignWithBudgetAndNotify, respondToDesignAndNotify } = await import('./design-acts');

const ROM = '2026-10-01T09:00:00.123456+00:00';
const RENDERS = '2026-10-02T09:00:00.654321+00:00';
const SEEN = { romIssuedAt: ROM, rendersIssuedAt: RENDERS };
const INPUT = { note: 'Lovely', ip: '1.2.3.4', userAgent: 'probe/1' };

beforeEach(() => {
  calls.log = [];
  respond.answers = {};
  respond.inputs = [];
  notified.acts = [];
  saved.delivery = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('approveDesignWithBudgetAndNotify', () => {
  it('S1: the budget is written first with the band issuance (no note), then the design with the round; nothing is read first', async () => {
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    expect(calls.log).toEqual(['write:acknowledge_rom', 'notify:budget_acknowledged', 'write:approve_design', 'notify:design_approved']);
    expect(respond.inputs).toEqual([
      { ...INPUT, note: null, action: 'acknowledge_rom', expectedIssueAt: ROM },
      { ...INPUT, action: 'approve_design', expectedIssueAt: RENDERS },
    ]);
    expect(notified.acts).toEqual([{ kind: 'budget_acknowledged' }, { kind: 'design_approved' }]);
  });

  it('S2: a re-issued band saves the design alone, and its notification says the budget is pending', async () => {
    respond.answers.acknowledge_rom = { ok: false, error: 'wrong_state' };
    saved.delivery = { stageKey: 'finalApproval', designDecision: null, rendersIssuedAt: RENDERS };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'approved', studioNotified: true, budget: 'changed' });
    expect(notified.acts).toEqual([{ kind: 'design_approved', budgetPending: true }]);
  });

  it('S3: re-issued renders save the budget alone; the design answers changed', async () => {
    respond.answers.approve_design = { ok: false, error: 'wrong_state' };
    saved.delivery = { stageKey: 'finalApproval', designDecision: null, rendersIssuedAt: '2026-10-03T09:00:00.000001+00:00' };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'changed', budget: 'acknowledged' });
    expect(notified.acts).toEqual([{ kind: 'budget_acknowledged' }]);
  });

  it('S3: a decision on file for ANOTHER round is not this tap\'s answer', async () => {
    respond.answers.approve_design = { ok: false, error: 'wrong_state' };
    saved.delivery = { stageKey: 'finalApproval', designDecision: { kind: 'approved', at: '2026-10-03T10:00:00.000Z' }, rendersIssuedAt: '2026-10-03T09:00:00.000001+00:00' };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'changed', budget: 'acknowledged' });
  });

  it('S4: both changed: neither is saved', async () => {
    respond.answers.acknowledge_rom = { ok: false, error: 'wrong_state' };
    respond.answers.approve_design = { ok: false, error: 'wrong_state' };
    saved.delivery = { stageKey: 'finalApproval', designDecision: null, rendersIssuedAt: null };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'changed', budget: 'changed' });
    expect(notified.acts).toEqual([]);
  });

  it('S6: a double tap answers from what is on file', async () => {
    respond.answers.acknowledge_rom = { ok: true, code: 'already' };
    respond.answers.approve_design = { ok: true, code: 'already' };
    saved.delivery = { stageKey: 'finalApproval', designDecision: { kind: 'approved', at: '2026-10-02T10:00:00.000Z' }, rendersIssuedAt: RENDERS };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
  });

  it.each(['token_expired', 'token_invalid'] as const)('S7: %s stops after ONE call', async (error) => {
    respond.answers.acknowledge_rom = { ok: false, error };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'error', error });
    expect(respond.inputs).toHaveLength(1);
  });

  it('S8: a stale tab after the delivery moved on answers the approval on file', async () => {
    respond.answers.approve_design = { ok: false, error: 'wrong_state' };
    saved.delivery = { stageKey: 'boq', designDecision: { kind: 'approved', at: '2026-10-02T10:00:00.000Z' }, rendersIssuedAt: RENDERS };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
  });

  it('R2: a budget half that THROWS stops the tap: the design is never sent, nobody is notified', async () => {
    respond.answers.acknowledge_rom = new Error('db blip');
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'error', error: 'generic' });
    expect(respond.inputs.map((input) => input.action)).toEqual(['acknowledge_rom']);
    expect(notified.acts).toEqual([]);
  });

  it('F3: an ended delivery with this band acknowledged on file answers acknowledged, not failed', async () => {
    respond.answers.acknowledge_rom = { ok: false, error: 'not_active' };
    respond.answers.approve_design = { ok: false, error: 'not_active' };
    const decision = { kind: 'approved', at: '2026-10-02T10:00:00.000Z' };
    saved.delivery = { stageKey: 'closed', designDecision: decision, rendersIssuedAt: RENDERS, romAcknowledgedAt: decision.at, rom: { issuedAt: ROM } };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
  });

  it('R1/F5: a budget refusal that is not a band change never tells the studio the budget is pending', async () => {
    respond.answers.acknowledge_rom = { ok: false, error: 'not_active' };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual({ kind: 'approved', studioNotified: true, budget: 'failed' });
    expect(notified.acts).toEqual([{ kind: 'design_approved' }]);
  });

  it.each([
    ['R4: a generic design refusal after a saved budget', { ok: false }, 'acknowledged', { kind: 'error', error: 'generic', budget: 'acknowledged' }],
    ['R4: a thrown design write after a saved budget', new Error('db blip'), 'acknowledged', { kind: 'error', error: 'generic', budget: 'acknowledged' }],
    ['a generic design refusal with nothing saved', { ok: false }, 'not_active', { kind: 'error', error: 'generic' }],
  ] as const)('%s', async (_label, designAnswer, budgetAnswer, expected) => {
    respond.answers.approve_design = designAnswer instanceof Error ? designAnswer : { ...designAnswer };
    if (budgetAnswer === 'not_active') respond.answers.acknowledge_rom = { ok: false, error: 'not_active' };
    expect(await approveDesignWithBudgetAndNotify('tok', INPUT, SEEN)).toEqual(expected);
  });
});

describe('respondToDesignAndNotify', () => {
  it('A1 (unit): the design write carries the round seen and no read precedes it', async () => {
    respond.answers.request_design_changes = { ok: false, error: 'wrong_state' };
    saved.delivery = { stageKey: 'finalApproval', designDecision: null, rendersIssuedAt: '2026-10-05T09:00:00Z' };
    expect(await respondToDesignAndNotify('tok', { ...INPUT, action: 'request_design_changes' }, SEEN)).toEqual({ kind: 'changed' });
    expect(calls.log).toEqual(['write:request_design_changes', 'read']);
    expect(respond.inputs[0]).toMatchObject({ action: 'request_design_changes', expectedIssueAt: RENDERS });
  });
});
