import { describe, expect, it } from 'vitest';
import type { EngagementEventKind } from '@metra/db';
import { findLatestClientChangeRequestNote } from './client-activity-note';
import type { EngagementClientActivityRecord } from './queries/client-activity';

function entry(
  kind: EngagementEventKind,
  note: string | null,
  decidedAt: string,
  actorName: string | null = null,
): EngagementClientActivityRecord {
  return {
    kind,
    actorName,
    note,
    rangeLow: null,
    rangeHigh: null,
    decidedAt: new Date(decidedAt),
  };
}

describe('findLatestClientChangeRequestNote', () => {
  it('returns null for an empty feed', () => {
    expect(findLatestClientChangeRequestNote([])).toBeNull();
  });

  it('returns the concept change-request note, trimmed', () => {
    const found = findLatestClientChangeRequestNote([
      entry('concept_change_request', '  please move the kitchen wall  ', '2026-03-01T10:00:00Z', 'Mona'),
    ]);
    expect(found?.note).toBe('please move the kitchen wall');
    expect(found?.kind).toBe('concept_change_request');
    expect(found?.actorName).toBe('Mona');
    expect(found?.decidedAt.toISOString()).toBe('2026-03-01T10:00:00.000Z');
  });

  it('returns a design change-request note too', () => {
    const found = findLatestClientChangeRequestNote([
      entry('design_change_request', 'swap the flooring', '2026-03-01T10:00:00Z'),
    ]);
    expect(found?.kind).toBe('design_change_request');
    expect(found?.note).toBe('swap the flooring');
  });

  it('returns null when every note is absent or blank', () => {
    expect(
      findLatestClientChangeRequestNote([
        entry('concept_change_request', null, '2026-03-02T10:00:00Z'),
        entry('design_change_request', '   ', '2026-03-01T10:00:00Z'),
        entry('concept_change_request', '\n\t ', '2026-02-28T10:00:00Z'),
      ]),
    ).toBeNull();
  });

  it('never returns an approval or acknowledgement note', () => {
    expect(
      findLatestClientChangeRequestNote([
        entry('concept_approval', 'looks great, ship it', '2026-03-05T10:00:00Z'),
        entry('design_approval', 'approved with thanks', '2026-03-04T10:00:00Z'),
        entry('rom_acknowledgement', 'budget noted', '2026-03-03T10:00:00Z'),
        entry('handoff_acknowledgement', 'received', '2026-03-02T10:00:00Z'),
      ]),
    ).toBeNull();
  });

  it('picks the change request over a NEWER approval that also has a note', () => {
    const found = findLatestClientChangeRequestNote([
      entry('concept_approval', 'looks great', '2026-03-09T10:00:00Z'),
      entry('design_change_request', 'raise the ceiling detail', '2026-03-08T10:00:00Z'),
    ]);
    expect(found?.note).toBe('raise the ceiling detail');
  });

  it('picks the NEWEST change-request note regardless of input order', () => {
    const found = findLatestClientChangeRequestNote([
      entry('concept_change_request', 'older ask', '2026-01-01T10:00:00Z'),
      entry('design_change_request', 'newest ask', '2026-06-01T10:00:00Z'),
      entry('concept_change_request', 'middle ask', '2026-03-01T10:00:00Z'),
    ]);
    expect(found?.note).toBe('newest ask');
  });

  it('skips a newer change request whose note is blank and falls back to the older one', () => {
    const found = findLatestClientChangeRequestNote([
      entry('design_change_request', '   ', '2026-06-01T10:00:00Z'),
      entry('concept_change_request', 'the real ask', '2026-01-01T10:00:00Z'),
    ]);
    expect(found?.note).toBe('the real ask');
  });

  it('resolves a decidedAt tie to the first entry in the feed order', () => {
    const found = findLatestClientChangeRequestNote([
      entry('design_change_request', 'first in feed order', '2026-04-01T10:00:00Z'),
      entry('concept_change_request', 'second in feed order', '2026-04-01T10:00:00Z'),
    ]);
    expect(found?.note).toBe('first in feed order');
  });

  it('lets a valid timestamp win over an unparseable one', () => {
    const found = findLatestClientChangeRequestNote([
      entry('concept_change_request', 'undated ask', 'not-a-date'),
      entry('design_change_request', 'dated ask', '2020-01-01T10:00:00Z'),
    ]);
    expect(found?.note).toBe('dated ask');
  });

  it('still returns the note when every timestamp is unparseable', () => {
    const found = findLatestClientChangeRequestNote([
      entry('concept_change_request', 'undated ask', 'not-a-date'),
    ]);
    expect(found?.note).toBe('undated ask');
  });
});
