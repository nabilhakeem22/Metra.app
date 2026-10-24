import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { OUTBOX_STATES, SITE_NOTE_KINDS } from './outbox/types';
import { SITE_PRESENCES } from './presence';

// The app reads these labels by a dynamic key (`presence.${verdict}`), which
// catalogue parity cannot see: a value missing from BOTH files would throw
// MISSING_MESSAGE on the engineer's phone. Each vocabulary equals its labels.

const vocabularies = [
  ['presence', SITE_PRESENCES],
  ['noteKind', SITE_NOTE_KINDS],
  ['outbox.state', OUTBOX_STATES],
] as const;

function labelsAt(messages: unknown, path: string): Record<string, unknown> {
  return path.split('.').reduce((node, segment) => (node as Record<string, unknown>)[segment], messages) as Record<string, unknown>;
}

describe('site.* labels', () => {
  it.each(vocabularies)('site.%s has one non-empty label per value, in both locales', (path, values) => {
    for (const messages of [en.site, ar.site]) {
      const labels = labelsAt(messages, path);
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
      for (const value of values) expect(String(labels[value]).trim()).not.toBe('');
    }
  });
});
