import { describe, expect, it } from 'vitest';
import { mergeLogEntries, type LogEntry } from './entries';

const entry = (
  id: string,
  source: 'activity' | 'audit',
  at: string,
  note: string | null = null,
): LogEntry => ({
  id,
  source,
  at,
  actorUserId: null,
  labelKey: source === 'activity' ? 'note' : 'client.update',
  note,
});

describe('mergeLogEntries', () => {
  it('interleaves both sources newest-first', () => {
    const merged = mergeLogEntries(
      [entry('a1', 'activity', '2026-03-01T10:00:00Z')],
      [
        entry('u1', 'audit', '2026-03-01T12:00:00Z'),
        entry('u2', 'audit', '2026-03-01T08:00:00Z'),
      ],
    );
    expect(merged.map((e) => e.id)).toEqual(['u1', 'a1', 'u2']);
  });

  it('puts activity above audit when they share a timestamp', () => {
    // A create writes both rows in one transaction, so identical timestamps are
    // routine. The human sentence reads better above the machine record of the
    // same moment, and the order must be stable rather than render-dependent.
    const sameMoment = '2026-03-01T10:00:00Z';
    const merged = mergeLogEntries(
      [entry('a1', 'activity', sameMoment)],
      [entry('u1', 'audit', sameMoment)],
    );
    expect(merged.map((e) => e.source)).toEqual(['activity', 'audit']);
  });

  it('is deterministic for two entries of the SAME source and timestamp', () => {
    const t = '2026-03-01T10:00:00Z';
    const once = mergeLogEntries([entry('a1', 'activity', t), entry('a2', 'activity', t)], []);
    const twice = mergeLogEntries([entry('a2', 'activity', t), entry('a1', 'activity', t)], []);
    expect(once.map((e) => e.id)).toEqual(twice.map((e) => e.id));
  });

  it('applies the cap AFTER merging, not per source', () => {
    // The bug this avoids: capping each source first would let a burst of audit
    // rows push every note out of the window before the merge even happens.
    const activity = Array.from({ length: 3 }, (_, i) =>
      entry(`a${i}`, 'activity', `2026-03-0${i + 1}T10:00:00Z`),
    );
    const audit = Array.from({ length: 3 }, (_, i) =>
      entry(`u${i}`, 'audit', `2026-03-0${i + 1}T11:00:00Z`),
    );
    const merged = mergeLogEntries(activity, audit, 4);
    expect(merged).toHaveLength(4);
    // The four newest overall, regardless of which source they came from.
    expect(merged[0].id).toBe('u2');
  });

  it('keeps a note body on an activity entry and never invents one for audit', () => {
    const merged = mergeLogEntries(
      [entry('a1', 'activity', '2026-03-01T10:00:00Z', 'Called the client')],
      [entry('u1', 'audit', '2026-03-01T09:00:00Z')],
    );
    expect(merged[0].note).toBe('Called the client');
    expect(merged[1].note).toBeNull();
  });

  it('handles either source being empty', () => {
    const only = [entry('a1', 'activity', '2026-03-01T10:00:00Z')];
    expect(mergeLogEntries(only, [])).toHaveLength(1);
    expect(mergeLogEntries([], only)).toHaveLength(1);
    expect(mergeLogEntries([], [])).toEqual([]);
  });
});
