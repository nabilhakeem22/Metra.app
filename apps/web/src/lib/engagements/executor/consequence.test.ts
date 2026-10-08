import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { TRANSITIONS } from '../transitions';
import { CONSEQUENCES, executeConsequence, type TransitionConsequence } from './consequence';

vi.mock('server-only', () => ({}));
const run = vi.hoisted(() => ({ runGatedTransition: vi.fn() }));
vi.mock('./run', () => run);

const ctx = { orgId: 'org-1', userId: 'user-1', role: 'owner' } as OrgContext;

beforeEach(() => {
  run.runGatedTransition.mockReset();
  run.runGatedTransition.mockResolvedValue({ ok: true });
});

describe('executeConsequence', () => {
  it('boqSent fires finalizeBOQ with the caller on the ledger and the cause on the audit', async () => {
    expect(await executeConsequence(ctx, { engagementId: 'e-1', consequence: 'boqSent' })).toEqual({ ok: true });
    expect(run.runGatedTransition).toHaveBeenCalledWith(
      ctx,
      TRANSITIONS.finalizeBOQ,
      { engagementId: 'e-1', trigger: 'finalizeBOQ' },
      { ledgerActorUserId: 'user-1', cause: 'boqSent' },
    );
  });

  it('handoverAcknowledged fires recipientAcknowledges with NO ledger actor', async () => {
    await executeConsequence(ctx, { engagementId: 'e-2', consequence: 'handoverAcknowledged' });
    expect(run.runGatedTransition).toHaveBeenCalledWith(
      ctx,
      TRANSITIONS.recipientAcknowledges,
      { engagementId: 'e-2', trigger: 'recipientAcknowledges' },
      { ledgerActorUserId: null, cause: 'handoverAcknowledged' },
    );
  });

  it('an unknown consequence (an untyped caller) runs nothing', async () => {
    const unknown = 'chooseExecution' as TransitionConsequence;
    expect(await executeConsequence(ctx, { engagementId: 'e-3', consequence: unknown })).toEqual({
      ok: false,
      error: 'illegal_trigger',
    });
    expect(run.runGatedTransition).not.toHaveBeenCalled();
  });

  it('no consequence is an ending: none of their edges has a decider list', () => {
    for (const { trigger } of Object.values(CONSEQUENCES)) {
      expect(TRANSITIONS[trigger].decidedBy, trigger).toBeUndefined();
    }
    expect(TRANSITIONS.chooseDesignOnly.decidedBy).toBeDefined();
    expect(TRANSITIONS.chooseExecution.decidedBy).toBeDefined();
  });
});
