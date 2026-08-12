// Bilingual "your proposal is ready" email. Server-side (no next-intl context),
// so copy is inlined. Contains NO cost or margin — only the client-facing total,
// number, and the accept link. Western numerals (§4.1).
export interface ProposalSentEmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
        `<p style="color:#334155;margin:4px 0;" dir="ltr">${line}</p>`,
    )
    .join('');

  const html = `<!doctype html><html dir="${dir}"><body style="font-family:system-ui,-apple-system,sans-serif;background:#f4f6fb;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 8px;">Metra</h1>
    <p style="color:#334155;">${intro}</p>
    ${meta}
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">${cta}</a>
    </p>
    <p style="color:#64748b;font-size:13px;">${fallback}</p>
    <p style="word-break:break-all;font-size:13px;"><a href="${url}">${url}</a></p>
  </div></body></html>`;

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
