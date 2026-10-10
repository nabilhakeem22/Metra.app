// "Your studio's payment details were changed": the email every owner and admin
// gets when someone edits the InstaPay or bank details the client page shows
// (Round C, owner decision Oct 10). Internal, so it is in the studio's register
// (Egyptian Arabic). It names WHO changed it and WHICH fields, never a value:
// the numbers stay behind the studio's own login.
import type { ClientPageField } from '@/lib/org/client-page-details';
import { automationEmail, type EmailContent } from './automation';

export interface PaymentDetailsChangedEmailInput {
  /** The member who saved the change, as the app shows them; null when unknown. */
  changedBy: string | null;
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

export function paymentDetailsChangedEmailTemplate(input: PaymentDetailsChangedEmailInput): EmailContent {
  const ar = input.locale.startsWith('ar');
  const name = input.changedBy?.trim() || null;
  const subject = ar ? 'بيانات الدفع بتاعة الاستوديو اتغيّرت' : "Your studio's payment details were changed";
  const heading = ar ? 'بيانات الدفع اتغيّرت' : 'Payment details changed';
  const who = ar
    ? `${name ?? 'حد من الفريق'} غيّر بيانات الدفع اللي العملاء بيشوفوها.`
    : `${name ?? 'Someone on your team'} changed the payment details your clients see.`;
  const labels = input.fields.map((field) => FIELD_LABEL[field][ar ? 'ar' : 'en']);
  const what = ar ? `اللي اتغيّر: ${labels.join('، ')}.` : `Changed: ${labels.join(', ')}.`;
  const check = ar
    ? 'لو مش انت ولا حد من فريقك، راجعها دلوقتي قبل ما عميل يحوّل عليها.'
    : 'If this was not you or your team, check them now, before a client pays into them.';
  const cta = { label: ar ? 'راجع بيانات الدفع' : 'Check the payment details', url: input.settingsUrl };
  return { subject, ...automationEmail(input.locale, heading, [who, what, check], cta) };
}
