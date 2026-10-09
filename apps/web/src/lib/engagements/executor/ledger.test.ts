import { describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '@/lib/audit';
import type { OrgContext } from '@/lib/db/context';
import { TRANSITIONS } from '../transitions';
import { auditStateMove, persistTransitionRow } from './ledger';
import type { TransitionRun } from './run';

/** A run whose tx records the ledger row it is asked to insert. */
function runWith(attribution: Pick<TransitionRun, 'ledgerActorUserId' | 'cause' | 'recordedBy'>) {
  const inserted: Record<string, unknown>[] = [];
  const audits: AuditEntry[] = [];
  const tx = {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { onConflictDoNothing: () => ({ returning: async () => [{ id: 'ledger-1' }] }) };
      },
    }),
  };
  const run = {
    tx,
    audit: vi.fn(async (entry: AuditEntry) => {
      audits.push(entry);
    }),
    ctx: { orgId: 'org-1', userId: 'owner-1', role: 'owner' } as OrgContext,
    def: TRANSITIONS.recipientAcknowledges,
    input: { engagementId: 'e-1', trigger: 'recipientAcknowledges' },
    idempotencyKey: null,
    ...attribution,
  } as unknown as TransitionRun;
  return { run, inserted, audits };
}

describe('the ledger row and the audit of a state move', () => {
  it('a person firing a trigger is the ledger actor and the audit names no cause', async () => {
    const { run, inserted, audits } = runWith({ ledgerActorUserId: 'owner-1', cause: null, recordedBy: null });
    await persistTransitionRow(run, 'design_only_handoff');
    await auditStateMove(run, 'design_only_handoff');
    expect(inserted[0]).toMatchObject({ actorUserId: 'owner-1', toState: 'closed_design_only' });
    expect(audits[0].after).toEqual({ state: 'closed_design_only' });
  });

  it('a consequence with no ledger actor writes NULL and audits its cause', async () => {
    const { run, inserted, audits } = runWith({ ledgerActorUserId: null, cause: 'handoverAcknowledged', recordedBy: 'site-1' });
    await persistTransitionRow(run, 'design_only_handoff');
    await auditStateMove(run, 'design_only_handoff');
    expect(inserted[0]).toMatchObject({ actorUserId: null, trigger: 'recipientAcknowledges' });
    expect(audits[0]).toMatchObject({
      before: { state: 'design_only_handoff' },
      after: { state: 'closed_design_only', cause: 'handoverAcknowledged', recordedBy: 'site-1' },
    });
  });
});
