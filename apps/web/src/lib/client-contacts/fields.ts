// A client contact's input and the paths a refusal can name. A plain module, so
// the contact sheet, the pure rules and the server core share it.

/** Every path a contact refusal can name; each is a box on the contact sheet. */
export const CONTACT_FIELDS = ['name', 'role', 'phone', 'email', 'whatsapp'] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];

export interface ContactInput {
  name?: string | null;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  isPrimary?: boolean;
}
