import type { ClientContact } from '@metra/db';

// The contact form's editable shape, and the two rules over it. PURE and
// server-safe: no React, no db write. "A contact needs a name" and "an emptied box
// is absent, not the empty string" are both product rules, and neither was
// callable from anywhere.

export interface ContactDraft {
  /** Null while adding; the contact's id while editing. */
  id: string | null;
  name: string;
  role: string;
  phone: string;
  email: string;
  whatsapp: string;
  /** Only offered on CREATE — an existing contact is promoted with its own action. */
  isPrimary: boolean;
}

export const EMPTY_CONTACT_DRAFT: ContactDraft = {
  id: null,
  name: '',
  role: '',
  phone: '',
  email: '',
  whatsapp: '',
  isPrimary: false,
};

/** A stored contact, as the form edits it. Absent columns become empty boxes. */
export function draftFromContact(contact: ClientContact): ContactDraft {
  return {
    id: contact.id,
    name: contact.name,
    role: contact.role ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    whatsapp: contact.whatsapp ?? '',
    isPrimary: contact.isPrimary,
  };
}

/**
 * Is this draft submittable at all?
 *
 * A name is the only thing a contact cannot be without: everything else is a way
 * to reach them, and a firm may genuinely know only a name. Whitespace does not
 * count — a space bar is not a name.
 */
export function validateDraft(draft: ContactDraft): boolean {
  return draft.name.trim() !== '';
}

/** The four optional columns, as the database stores them: '' becomes NULL, so
 *  "the user cleared the box" and "the user never filled it in" are one value. */
export function contactPayload(draft: ContactDraft): {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
} {
  return {
    name: draft.name,
    role: draft.role || null,
    phone: draft.phone || null,
    email: draft.email || null,
    whatsapp: draft.whatsapp || null,
  };
}
