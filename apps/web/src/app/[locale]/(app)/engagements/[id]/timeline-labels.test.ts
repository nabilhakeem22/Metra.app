import { describe, expect, test } from 'vitest';
import { build, event, transition } from './timeline-entries.fixture';

describe('a move Metra made (a ledger row with no actor)', () => {
  test('a person firing a trigger reads as the move', () => {
    expect(build({ transitions: [transition()] })[0].label).toBe('created->design_proposal');
  });

  test('a null actor reads as the move, by Metra', () => {
    const boqStep = transition({ trigger: 'finalizeBOQ', fromState: 'boq', toState: 'execution_decision', actorUserId: null });
    expect(build({ transitions: [boqStep] })[0].label).toBe('boq->execution_decision by Metra');
  });

  test('the handover confirmation closing the delivery says exactly that', () => {
    const closed = transition({
      trigger: 'recipientAcknowledges',
      fromState: 'design_only_handoff',
      toState: 'closed_design_only',
      actorUserId: null,
    });
    expect(build({ transitions: [closed] })[0].label).toBe('closed on confirmation');
  });

  test("a close that follows the studio's recording of the confirmation says so", () => {
    const closed = transition({
      trigger: 'recipientAcknowledges',
      fromState: 'design_only_handoff',
      toState: 'closed_design_only',
      actorUserId: null,
    });
    const staffAck = event({ id: 'ack-staff', kind: 'handoff_acknowledgement', actorChannel: 'staff' });
    const clientAck = event({ id: 'ack-client', kind: 'handoff_acknowledgement', actorChannel: 'client' });
    const label = (events: ReturnType<typeof event>[]) =>
      build({ transitions: [closed], events }).find((entry) => entry.id === 't-tr-1')!.label;
    expect(label([staffAck])).toBe('closed on recorded confirmation');
    expect(label([clientAck])).toBe('closed on confirmation');
    // A retracted staff recording is not what closed it.
    const retraction = event({ id: 'fix', kind: 'event_correction', supersedesEventId: 'ack-staff' });
    expect(label([staffAck, retraction])).toBe('closed on confirmation');
  });

  test('the same edge fired by a person keeps the plain move', () => {
    const byOwner = transition({
      trigger: 'recipientAcknowledges',
      fromState: 'design_only_handoff',
      toState: 'closed_design_only',
    });
    expect(build({ transitions: [byOwner] })[0].label).toBe('design_only_handoff->closed_design_only');
  });
});
