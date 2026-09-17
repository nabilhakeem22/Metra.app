import { describe, expect, test } from 'vitest';
import type { ClientContact } from '@metra/db';
import {
  EMPTY_CONTACT_DRAFT,
  contactPayload,
  draftFromContact,
  validateDraft,
} from './contact-draft';

function contact(overrides: Partial<ClientContact> = {}): ClientContact {
  return {
    id: 'contact-1',
    name: 'Mona Hassan',
    role: 'Procurement',
    phone: '+201000000000',
    email: 'mona@nile.example',
    whatsapp: '+201000000000',
    isPrimary: true,
    ...overrides,
  } as ClientContact;
}

describe('EMPTY_CONTACT_DRAFT', () => {
  test('every box starts empty, with no id and not primary', () => {
    expect(EMPTY_CONTACT_DRAFT).toEqual({
      id: null,
      name: '',
      role: '',
      phone: '',
      email: '',
      whatsapp: '',
      isPrimary: false,
    });
  });

  test('it is not submittable', () => {
    expect(validateDraft(EMPTY_CONTACT_DRAFT)).toBe(false);
  });
});

describe('draftFromContact', () => {
  test('a fully populated contact round-trips', () => {
    expect(draftFromContact(contact())).toEqual({
      id: 'contact-1',
      name: 'Mona Hassan',
      role: 'Procurement',
      phone: '+201000000000',
      email: 'mona@nile.example',
      whatsapp: '+201000000000',
      isPrimary: true,
    });
  });

  test('NULL columns become EMPTY BOXES, never the string "null"', () => {
    const draft = draftFromContact(
      contact({ role: null, phone: null, email: null, whatsapp: null }),
    );
    expect(draft).toMatchObject({ role: '', phone: '', email: '', whatsapp: '' });
  });

  test('editing carries the id, which is what makes the form an UPDATE', () => {
    expect(draftFromContact(contact()).id).toBe('contact-1');
    expect(EMPTY_CONTACT_DRAFT.id).toBeNull();
  });
});

describe('validateDraft', () => {
  test('a name is the only requirement', () => {
    expect(validateDraft({ ...EMPTY_CONTACT_DRAFT, name: 'Mona' })).toBe(true);
  });

  test.each(['', ' ', '\t', '\n', '   '])('%j is not a name', (name) => {
    expect(validateDraft({ ...EMPTY_CONTACT_DRAFT, name })).toBe(false);
  });

  test('a firm may know only a name — no phone, no email, no role', () => {
    expect(
      validateDraft({ ...EMPTY_CONTACT_DRAFT, name: 'Mona', role: '', phone: '', email: '' }),
    ).toBe(true);
  });
});

describe('contactPayload', () => {
  test('an EMPTIED box becomes NULL, so cleared and never-filled are one value', () => {
    const payload = contactPayload({ ...EMPTY_CONTACT_DRAFT, name: 'Mona' });
    expect(payload).toEqual({
      name: 'Mona',
      role: null,
      phone: null,
      email: null,
      whatsapp: null,
    });
  });

  test('a filled box is carried through verbatim', () => {
    expect(contactPayload(draftFromContact(contact()))).toEqual({
      name: 'Mona Hassan',
      role: 'Procurement',
      phone: '+201000000000',
      email: 'mona@nile.example',
      whatsapp: '+201000000000',
    });
  });

  test('the payload carries NEITHER the id NOR isPrimary — the callers differ on both', () => {
    const payload = contactPayload(draftFromContact(contact()));
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('isPrimary');
  });
});
