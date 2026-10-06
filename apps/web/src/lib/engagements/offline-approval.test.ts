import { describe, expect, test } from 'vitest';
import { OFFLINE_APPROVAL_CHANNELS, parseOfflineApproval } from './offline-approval';

const TODAY = '2026-10-07';
const OPTION_ID = '11111111-1111-4111-8111-111111111111';

describe('parseOfflineApproval', () => {
  test.each(OFFLINE_APPROVAL_CHANNELS)('accepts the %s channel alone', (channel) => {
    expect(parseOfflineApproval({ channel }, TODAY)).toEqual({
      channel,
      occurredOn: null,
      note: null,
      chosenArtifactId: null,
    });
  });

  test('carries a past date, a trimmed note and a chosen option', () => {
    expect(
      parseOfflineApproval(
        { channel: 'phone', occurredOn: '2026-10-05', note: '  She said yes  ', chosenArtifactId: OPTION_ID },
        TODAY,
      ),
    ).toEqual({ channel: 'phone', occurredOn: '2026-10-05', note: 'She said yes', chosenArtifactId: OPTION_ID });
  });

  test('blank optional fields read as absent', () => {
    expect(parseOfflineApproval({ channel: 'email', occurredOn: '', note: '   ' }, TODAY)).toEqual({
      channel: 'email',
      occurredOn: null,
      note: null,
      chosenArtifactId: null,
    });
  });

  test.each([
    ['no payload', undefined],
    ['null', null],
    ['an array', ['phone']],
    ['a string', 'phone'],
    ['an unknown channel', { channel: 'fax' }],
    ['a missing channel', { note: 'yes' }],
    ['a future date', { channel: 'phone', occurredOn: '2026-10-08' }],
    ['a day the calendar does not have', { channel: 'phone', occurredOn: '2026-02-31' }],
    ['a non-string note', { channel: 'phone', note: 42 }],
    ['a note over the cap', { channel: 'phone', note: 'x'.repeat(2001) }],
    ['a chosen option that is not a uuid', { channel: 'phone', chosenArtifactId: 'option-a' }],
  ])('refuses %s', (_label, payload) => {
    expect(parseOfflineApproval(payload, TODAY)).toBeNull();
  });

  test('a note exactly at the cap is accepted', () => {
    expect(parseOfflineApproval({ channel: 'other', note: 'x'.repeat(2000) }, TODAY)?.note).toHaveLength(2000);
  });
});
