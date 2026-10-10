// "What your clients see was changed": the email every owner and admin gets
// when someone edits the phone, WhatsApp, InstaPay or bank details the client
// page shows (Round C, owner decisions Oct 10). Internal, so it is in the
// studio's register (Egyptian Arabic). It names WHO changed it by their
// VERIFIED email, with their self-chosen display name only beside it (fix
// round S1), and WHICH fields, never a value: the numbers stay behind the
// studio's own login.
import type { ClientPageField } from '@/lib/org/client-page-details';
import { actorLabel, type ActorIdentity } from '@/lib/team/display-name';
import { automationEmail, type EmailContent } from './automation';

export interface ClientPageDetailsChangedEmailInput {
  /** The member who saved the change, from their auth session. */
  changedBy: ActorIdentity;
  fields: readonly ClientPageField[];
  /** Settings, at the client page card. */
  settingsUrl: string;
  locale: string;
}

const FIELD_LABEL: Record<ClientPageField, { ar: string; en: string }> = {
  studioPhone: { ar: 'رقم التليفون', en: 'phone' },
  studioWhatsapp: { ar: 'رقم الواتساب', en: 'WhatsApp' },
  instapayAddress: { ar: 'عنوان InstaPay', en: 'InstaPay address' },
  bankName: { ar: 'اسم البنك', en: 'bank name' },
  bankAccountHolder: { ar: 'اسم صاحب الحساب', en: 'account holder' },
  bankAccountNumber: { ar: 'رقم الحساب', en: 'account number' },
  bankIban: { ar: 'الآيبان', en: 'IBAN' },
};

export function clientPageDetailsChangedEmailTemplate(input: ClientPageDetailsChangedEmailInput): EmailContent {
  const ar = input.locale.startsWith('ar');
  const who = actorLabel(input.changedBy);
  const subject = ar ? 'البيانات اللي العملاء بيشوفوها اتغيّرت' : 'What your clients see was changed';
  const heading = ar ? 'بيانات التواصل والدفع اتغيّرت' : 'Contact and payment details changed';
  const line = ar
    ? `${who ?? 'حد من الفريق'} غيّر بيانات التواصل والدفع اللي العملاء بيشوفوها.`
    : `${who ?? 'Someone on your team'} changed the contact and payment details your clients see.`;
  const labels = input.fields.map((field) => FIELD_LABEL[field][ar ? 'ar' : 'en']);
  const what = ar ? `اللي اتغيّر: ${labels.join('، ')}.` : `Changed: ${labels.join(', ')}.`;
  const check = ar
    ? 'لو مش انت ولا حد من فريقك، راجعها دلوقتي قبل ما عميل يكلّم الرقم ده أو يحوّل عليه.'
    : 'If this was not you or your team, check them now, before a client calls that number or pays into it.';
  const cta = { label: ar ? 'راجع البيانات' : 'Check the details', url: input.settingsUrl };
  return { subject, ...automationEmail(input.locale, heading, [line, what, check], cta) };
}
