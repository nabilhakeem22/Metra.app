import { describe, expect, it } from 'vitest';
import { changedDraftFields, clientPageDraftOf } from './client-page-fields';

describe('changedDraftFields (F1: a stale sheet sends only what its member changed)', () => {
  const initial = clientPageDraftOf({ studioPhone: '01012345678', bankName: 'CIB', bankAccountNumber: '1111222233334444' });

  it('sends nothing when nothing was touched', () => {
    expect(changedDraftFields(initial, { ...initial })).toEqual({});
  });

  it('sends only the edited boxes, and an emptied box as an explicit null', () => {
    expect(changedDraftFields(initial, { ...initial, studioPhone: '01112345678', bankName: '  ' })).toEqual({
      studioPhone: '01112345678',
      bankName: null,
    });
  });

  it('never sends the account number it did not touch', () => {
    expect(changedDraftFields(initial, { ...initial, studioWhatsapp: '01012345678' })).not.toHaveProperty('bankAccountNumber');
  });
});
