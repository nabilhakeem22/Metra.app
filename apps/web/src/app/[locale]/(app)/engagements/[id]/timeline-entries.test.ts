import { describe, expect, test } from 'vitest';
import { trimmedNote } from './timeline-entries';
import { build, clientActivity, event, transition } from './timeline-entries.fixture';

describe('trimmedNote', () => {
  test.each([
    [null, null],
    [undefined, null],
    ['', null],
    ['   ', null],
    ['\n\t', null],
    ['  said no  ', 'said no'],
  ])('%j -> %j', (input, expected) => {
    expect(trimmedNote(input as string | null)).toBe(expected);
  });
});

describe('buildTimelineEntries — what appears', () => {
  test('nothing at all is an empty ledger, not a crash', () => {
    expect(build({})).toEqual([]);
  });

  test('a transition with both states reads as an arrow; without, as a state', () => {
    expect(build({ transitions: [transition()] })[0]?.label).toBe(
      'created->design_proposal',
    );
    expect(
      build({ transitions: [transition({ fromState: null })] })[0]?.label,
    ).toBe('state:design_proposal');
  });

  // Rendering both drew every genuine client acknowledgement TWICE and made this
  // ledger unreliable to COUNT — which matters, because counting it is what
  // somebody does in a dispute.
  test('a CLIENT-CHANNEL event is skipped: it arrives again through clientActivity', () => {
    const entries = build({
      events: [event({ id: 'ev-client', actorChannel: 'client' })],
      clientActivity: [clientActivity()],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('c-rom_acknowledgement-0');
    expect(entries[0]?.label).toBe('kind:rom_acknowledgement by Mona');
  });

  test('a staff event and a client-activity row both survive', () => {
    const entries = build({ events: [event()], clientActivity: [clientActivity()] });
    expect(entries.map((entry) => entry.id)).toEqual([
      'c-rom_acknowledgement-0',
      'e-ev-1',
    ]);
  });

  test('a client-activity row with no actor name still reads', () => {
    expect(build({ clientActivity: [clientActivity({ actorName: null })] })[0]?.label).toBe(
      'kind:rom_acknowledgement',
    );
  });
});

describe('buildTimelineEntries — corrections', () => {
  const target = event({ id: 'ev-target' });
  const correction = event({
    id: 'ev-correction',
    supersedesEventId: 'ev-target',
    note: 'wrong client',
    decidedAt: new Date('2026-06-05T10:00:00.000Z'),
  });

  test('a correction is NOT an entry of its own', () => {
    const entries = build({ events: [target, correction] });
    expect(entries.map((entry) => entry.id)).toEqual(['e-ev-target']);
  });

  test('it is attached to the row it retracts, with its note', () => {
    const entries = build({ events: [target, correction] });
    expect(entries[0]?.retraction?.id).toBe('ev-correction');
    expect(entries[0]?.retraction?.note).toBe('wrong client');
  });

  test('a row nobody retracted carries no retraction', () => {
    expect(build({ events: [target] })[0]?.retraction).toBeNull();
  });

  // The retracted row STAYS. The ledger is append-only precisely so a mistake and
  // its withdrawal are BOTH on the record; the guards stop counting it, this view
  // does not stop showing it.
  test('the retracted row is still present', () => {
    expect(build({ events: [target, correction] })).toHaveLength(1);
  });
});

describe('buildTimelineEntries — order', () => {
  test('NEWEST FIRST, across all three streams', () => {
    const entries = build({
      transitions: [transition({ id: 'old', decidedAt: new Date('2026-01-01') })],
      events: [event({ id: 'mid', decidedAt: new Date('2026-06-01') })],
      clientActivity: [clientActivity({ decidedAt: new Date('2026-12-01') })],
    });
    expect(entries.map((entry) => entry.id)).toEqual([
      'c-rom_acknowledgement-0',
      'e-mid',
      't-old',
    ]);
  });
});

describe('buildTimelineEntries — the on-behalf marker', () => {
  test('a staff-recorded acknowledgement is marked, and carries its provenance', () => {
    const entries = build({
      events: [event({ occurredOn: '2026-05-30', evidence: 'confirmed by phone' })],
    });
    expect(entries[0]?.onBehalf).toBe(true);
    expect(entries[0]?.occurredOn).toBe('2026-05-30');
    expect(entries[0]?.evidence).toBe('confirmed by phone');
  });

  test('an approval the client gave offline is marked, its channel in the reader’s words', () => {
    const entries = build({
      events: [event({ kind: 'design_approval', evidence: 'phone', occurredOn: '2026-05-30', note: 'Yes' })],
    });
    expect(entries[0]?.onBehalf).toBe(true);
    expect(entries[0]?.evidence).toBe('channel:phone');
    expect(entries[0]?.occurredOn).toBe('2026-05-30');
  });

  test('the studio approving by Advance is not marked', () => {
    expect(build({ events: [event({ kind: 'design_approval' })] })[0]?.onBehalf).toBe(false);
  });

  test('a transition and a client-activity row are never on-behalf', () => {
    expect(build({ transitions: [transition()] })[0]?.onBehalf).toBe(false);
    expect(build({ clientActivity: [clientActivity()] })[0]?.onBehalf).toBe(false);
  });
});

describe('a concept choice carries the letter SAVED with it (B12)', () => {
  test('on the client row and on a choice the studio recorded offline', () => {
    const entries = build({
      clientActivity: [clientActivity({ kind: 'concept_approval', chosenPosition: 2 })],
      events: [event({ id: 'ev-offline', kind: 'concept_approval', chosenPosition: 1 })],
      transitions: [transition()],
    });
    expect(entries.map((entry) => entry.optionPosition)).toEqual([2, 1, null]);
  });
});
