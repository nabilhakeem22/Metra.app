import { describe, expect, test } from 'vitest';
import { MEMBER_ROLES } from '@/lib/permissions/roles';
import {
  OFFLINE_APPROVAL_CHANNELS,
  mayRecordOfflineApproval,
  parseOfflineApproval,
} from './offline-approval';

// The round under review began on the 1st; today (Cairo) is the 7th.
const BOUNDS = { earliest: '2026-10-01', latest: '2026-10-07' };
const OPTION_ID = '11111111-1111-4111-8111-111111111111';

const parse = (payload: unknown) => parseOfflineApproval(payload, BOUNDS);

describe('parseOfflineApproval', () => {
  test.each(OFFLINE_APPROVAL_CHANNELS)('accepts the %s channel alone', (channel) => {
    expect(parse({ channel })).toEqual({
      ok: true,
      approval: { channel, occurredOn: null, note: null, chosenArtifactId: null },
    });
  });

  test('carries a date inside the round, a trimmed note and a chosen option', () => {
    expect(
      parse({ channel: 'phone', occurredOn: '2026-10-05', note: '  She said yes  ', chosenArtifactId: OPTION_ID }),
    ).toEqual({
      ok: true,
      approval: { channel: 'phone', occurredOn: '2026-10-05', note: 'She said yes', chosenArtifactId: OPTION_ID },
    });
  });

  test('both ends of the round are inclusive', () => {
    expect(parse({ channel: 'phone', occurredOn: '2026-10-01' }).ok).toBe(true);
    expect(parse({ channel: 'phone', occurredOn: '2026-10-07' }).ok).toBe(true);
  });

  test('blank optional fields read as absent', () => {
    expect(parse({ channel: 'email', occurredOn: '', note: '   ' })).toEqual({
      ok: true,
      approval: { channel: 'email', occurredOn: null, note: null, chosenArtifactId: null },
    });
  });

  test.each([
    ['before the round under review', '2026-09-30'],
    ['far in the past', '1900-01-01'],
    ['after today', '2026-10-08'],
  ])('a date %s is out of range, named as such', (_label, occurredOn) => {
    expect(parse({ channel: 'phone', occurredOn })).toEqual({
      ok: false,
      fields: { occurredOn: { code: 'offline_approval_date_out_of_range' } },
    });
  });

  test('a note over the cap is too long under the note, with its cap; exactly at the cap is accepted', () => {
    expect(parse({ channel: 'phone', note: 'x'.repeat(2001) })).toEqual({
      ok: false,
      fields: { note: { code: 'too_long', params: { max: 2000 } } },
    });
    const atCap = parse({ channel: 'other', note: 'x'.repeat(2000) });
    expect(atCap.ok && atCap.approval.note).toHaveLength(2000);
  });

  test.each([
    ['no payload', undefined],
    ['null', null],
    ['an array', ['phone']],
    ['a string', 'phone'],
    ['an unknown channel', { channel: 'fax' }],
    ['a non-string note', { channel: 'phone', note: 42 }],
    ['a chosen option that is not a uuid', { channel: 'phone', chosenArtifactId: 'option-a' }],
  ])('refuses %s as malformed', (_label, payload) => {
    expect(parse(payload)).toEqual({ ok: false, code: 'malformed' });
  });

  test('no channel chosen is required under the channel', () => {
    expect(parse({ note: 'yes' })).toEqual({ ok: false, fields: { channel: { code: 'required' } } });
  });

  test.each([
    ['a day the calendar does not have', '2026-02-31'],
    ['a date that is not YYYY-MM-DD', '05/10/2026'],
  ])('%s is invalid_date under the day', (_label, occurredOn) => {
    expect(parse({ channel: 'phone', occurredOn })).toEqual({
      ok: false,
      fields: { occurredOn: { code: 'invalid_date' } },
    });
  });
});

describe('mayRecordOfflineApproval (owner decision, Oct 7)', () => {
  test.each([...MEMBER_ROLES])('%s', (role) => {
    expect(mayRecordOfflineApproval(role)).toBe(
      role === 'owner' || role === 'admin' || role === 'project_manager',
    );
  });
});
