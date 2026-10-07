// Who a delivery reminder goes to and who it is from, read inside the caller's
// RLS transaction (Round B, B11). SERVER-SIDE. Which phone and which address
// win is one pure rule, ./channels.ts (the client record over the primary
// contact's stale copy).
import { clientContacts, clients, organizations, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail } from '@/lib/actions/result';
import { reminderChannels } from './channels';

type Bilingual = { nameAr: string | null; nameEn: string | null };

export interface ReminderRecipient {
  client: Bilingual;
  studio: Bilingual;
  /** organizations.default_locale: the language the reminder opens in. */
  defaultLocale: 'ar-EG' | 'en';
  /** The raw phone to message on WhatsApp (normalised by whatsappDigits). */
  phone: string | null;
  email: string | null;
}

/** The delivery's client, its primary contact and the studio. `engagement_not_found` if the client is gone. */
export async function readReminderRecipient(
  tx: MetraDb,
  orgId: string,
  clientId: string,
): Promise<ReminderRecipient> {
  const [client] = await tx
    .select({ nameAr: clients.nameAr, nameEn: clients.nameEn, phone: clients.phone, email: clients.email })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) fail('engagement_not_found');
  const [contact] = await tx
    .select({ whatsapp: clientContacts.whatsapp, phone: clientContacts.phone, email: clientContacts.email })
    .from(clientContacts)
    .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)))
    .limit(1);
  const [studio] = await tx
    .select({
      nameAr: organizations.nameAr,
      nameEn: organizations.nameEn,
      defaultLocale: organizations.defaultLocale,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return {
    client: { nameAr: client.nameAr, nameEn: client.nameEn },
    studio: { nameAr: studio?.nameAr ?? null, nameEn: studio?.nameEn ?? null },
    defaultLocale: studio?.defaultLocale === 'en' ? 'en' : 'ar-EG',
    ...reminderChannels({ client, primaryContact: contact ?? null }),
  };
}
