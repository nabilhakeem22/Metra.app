// Bilingual "your proposal is ready" email. Server-side (no next-intl context),
// so copy is inlined. Contains NO cost or margin — only the client-facing total,
// number, and the accept link. Western numerals (§4.1).
import { EMAIL_BRAND } from '@/lib/email/brand';
import { escapeHtml } from '@/lib/html/escape';
import { emailShell } from './shell';

export interface ProposalSentEmailContent {
  subject: string;
  html: string;
  text: string;
}

export function proposalSentEmailTemplate(input: {
  orgName: string;
  proposalNumber: string;
  totalDisplay?: string | null;
  expiryDate?: string | null;
  acceptUrl: string;
  locale: string;
}): ProposalSentEmailContent {
  const ar = input.locale.startsWith('ar');
  const dir = ar ? 'rtl' : 'ltr';
  const org = escapeHtml(input.orgName);
  const num = escapeHtml(input.proposalNumber);
  const url = input.acceptUrl;

  const subject = ar
    ? `عرض سعر ${input.proposalNumber} من ${input.orgName}`
    : `Quotation ${input.proposalNumber} from ${input.orgName}`;

  const intro = ar
    ? `أرسلت إليك «${org}» عرض السعر ${num} للاطلاع.`
    : `"${org}" has sent you quotation ${num} for review.`;

  const totalLine =
    input.totalDisplay != null && input.totalDisplay !== ''
      ? ar
        ? `الإجمالي: ${escapeHtml(input.totalDisplay)}`
        : `Total: ${escapeHtml(input.totalDisplay)}`
      : null;

  const expiryLine =
    input.expiryDate != null && input.expiryDate !== ''
      ? ar
        ? `صالح حتى ${escapeHtml(input.expiryDate)}`
        : `Valid until ${escapeHtml(input.expiryDate)}`
      : null;

  const cta = ar ? 'عرض العرض والرد عليه' : 'View & respond to the quote';
  const fallback = ar
    ? 'إذا لم يعمل الزر، انسخ هذا الرابط في متصفحك:'
    : "If the button doesn't work, copy this link into your browser:";

  const meta = [totalLine, expiryLine]
    .filter(Boolean)
    .map(
      (line) =>
        `<p style="color:${EMAIL_BRAND.body};margin:4px 0;" dir="ltr">${line}</p>`,
    )
    .join('');

  const html = emailShell({
    dir,
    // The optional total/expiry lines sit on their own line under the intro,
    // exactly where `${meta}` used to interpolate (and render as bare
    // indentation when both are absent).
    bodyHtml: `    <p style="color:${EMAIL_BRAND.body};">${intro}</p>\n    ${meta}`,
    cta: { label: cta, url },
    fallbackNote: fallback,
  });

  const textLines = [
    intro,
    totalLine,
    expiryLine,
    '',
    `${cta}: ${url}`,
  ].filter((l) => l !== null && l !== undefined);
  const text = `${textLines.join('\n')}\n`;

  return { subject, html, text };
}
