// Where a delivery reminder lands: which phone WhatsApp opens on, which address
// the email goes to. PURE and CLIENT-SAFE, so the precedence is one tested rule.
//
// THE CLIENT RECORD WINS over the primary contact's copy. createClientCore seeds
// the primary contact with a COPY of the client's phone and email, and
// updateClientCore edits only the client row, so after the studio fixes a
// mistyped phone on the client form the contact still holds the old one. The
// contact's `whatsapp` is different: it is never seeded, only ever typed on
// purpose, so a WhatsApp number entered there is the most specific answer.
//
//   WhatsApp: contact `whatsapp`, then client `phone`, then contact `phone`;
//   email:    client `email`, then contact `email`.

export interface ReminderChannelSources {
  client: { phone: string | null; email: string | null };
  primaryContact: { whatsapp: string | null; phone: string | null; email: string | null } | null;
}

export interface ReminderChannels {
  phone: string | null;
  email: string | null;
}

/** The first non-blank value, trimmed, or null. */
function firstPresent(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function reminderChannels({ client, primaryContact }: ReminderChannelSources): ReminderChannels {
  return {
    phone: firstPresent(primaryContact?.whatsapp, client.phone, primaryContact?.phone),
    email: firstPresent(client.email, primaryContact?.email),
  };
}
