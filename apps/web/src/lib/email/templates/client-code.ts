// "Your verification code": the one-time code a CLIENT asked for on their
// project page, before an act that binds them ("I paid"). Server-side, no
// next-intl context, so the copy is inlined. CLIENT register: Arabic is فصحى,
// like every client-facing delivery surface. Latin digits, no dash, the
// existing shell (no branding change).
//
// The code is plain text, in the subject and the body. The ONE link is the
// client's own project page, the page the code is typed into. Every name and
// number here came from the database (app_home_code_issue_by_token), never
// from the browser: a link holder must not be able to put words of their own
// into an email that reaches the client.
import { EMAIL_BRAND } from '@/lib/email/brand';
import { NAME_MAX_CHARS, oneLine } from '@/lib/format/one-line';
import type { CodePurpose } from '@/lib/client-home/code-answers';
import { escapeHtml } from '@/lib/html/escape';
import type { EmailContent } from './automation';
import { emailShell } from './shell';

export interface ClientCodeEmailInput {
  code: string;
  purpose: CodePurpose;
  /** The request's PR number, or the delivery's DE number for a design instalment. */
  documentNumber: string;
  studioName: string;
  /** The client's project page, where the code is typed. */
  homeUrl: string;
  locale: string;
}

/** Ten minutes, as the database's CHECK holds it (client_verification_codes_life). */
const VALID_MINUTES = 10;

/** What the code is for, in the client's words. */
function purposeOf(purpose: CodePurpose, documentNumber: string, ar: boolean): string {
  if (purpose === 'claim_request') {
    return ar ? `لتأكيد إبلاغك بسداد مطالبة الدفع ${documentNumber}` : `to confirm that you paid payment request ${documentNumber}`;
  }
  return ar
    ? `لتأكيد إبلاغك بسداد دفعة من أتعاب التصميم في المشروع ${documentNumber}`
    : `to confirm that you paid a design fee instalment on ${documentNumber}`;
}

export function clientCodeEmailTemplate(input: ClientCodeEmailInput): EmailContent {
  const ar = input.locale.startsWith('ar');
  // Studio-typed and unbounded: one capped line before it reaches the body.
  const studio = oneLine(input.studioName, NAME_MAX_CHARS);
  const purpose = purposeOf(input.purpose, input.documentNumber, ar);

  const subject = ar ? `رمز التحقق: ${input.code}` : `Your verification code: ${input.code}`;
  const asked = ar
    ? `طلبتَ رمز تحقق من صفحة مشروعك مع ${studio} ${purpose}.`
    : `You asked for a verification code on your project page with ${studio}, ${purpose}.`;
  const codeLine = ar ? 'رمز التحقق:' : 'Your code:';
  const validity = ar
    ? `الرمز صالح لمدة ${VALID_MINUTES} دقائق، ويُستخدم مرة واحدة. لا تشاركه مع أحد.`
    : `The code is valid for ${VALID_MINUTES} minutes and works once. Do not share it with anyone.`;
  const notYou = ar
    ? `إن لم تطلب هذا الرمز فتجاهل هذه الرسالة وأبلغ ${studio}.`
    : `If you did not ask for this code, ignore this message and tell ${studio}.`;
  const cta = ar ? 'فتح صفحة المشروع' : 'Open your project page';

  const paragraph = (line: string) => `    <p style="color:${EMAIL_BRAND.body};">${escapeHtml(line)}</p>`;
  const html = emailShell({
    dir: ar ? 'rtl' : 'ltr',
    bodyHtml: [
      paragraph(asked),
      paragraph(codeLine),
      `    <p dir="ltr" style="color:${EMAIL_BRAND.text};font-size:28px;font-weight:700;letter-spacing:6px;text-align:center;">${escapeHtml(input.code)}</p>`,
      paragraph(validity),
      paragraph(notYou),
    ].join('\n'),
    cta: { label: escapeHtml(cta), url: input.homeUrl },
  });
  const text = `${asked}\n\n${codeLine} ${input.code}\n\n${validity}\n${notYou}\n\n${cta}: ${input.homeUrl}\n`;
  return { subject, html, text };
}
