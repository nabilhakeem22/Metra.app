// "Your design is waiting for you": the reminder a studio sends its CLIENT,
// carrying the link the client already holds (Round B, B11). Server-side, no
// next-intl context, so the copy is inlined. CLIENT register: Arabic is فصحى,
// like every client-facing delivery surface. Latin digits, no dash, the
// existing shell (no branding change). No money, no stage detail: the portal
// behind the link says what is waiting.
import { EMAIL_BRAND } from '@/lib/email/brand';
import { escapeHtml } from '@/lib/html/escape';
import type { EmailContent } from './automation';
import { emailShell } from './shell';

export interface DeliveryReminderEmailInput {
  clientName: string;
  studioName: string;
  /** The client's EXISTING portal link, in the email's locale. */
  portalUrl: string;
  locale: string;
}

export function deliveryReminderEmailTemplate(input: DeliveryReminderEmailInput): EmailContent {
  const ar = input.locale.startsWith('ar');
  const client = input.clientName.trim();
  const studio = input.studioName.trim();

  const subject = ar
    ? `تذكير من ${studio}: مشروع التصميم بانتظارك`
    : `A reminder from ${studio}: your design is waiting for you`;
  const greeting = ar
    ? client
      ? `مرحبًا ${client}،`
      : 'مرحبًا،'
    : client
      ? `Hello ${client},`
      : 'Hello,';
  const body = ar
    ? `يذكّرك فريق ${studio} بأن مشروع التصميم الخاص بك بانتظار اطلاعك. يمكنك مراجعة آخر المستجدات والرد من خلال صفحتك.`
    : `${studio} would like to remind you that your design project is waiting for you. You can review the latest updates and reply from your page.`;
  const cta = ar ? 'فتح صفحة المشروع' : 'Open your project page';
  const fallback = ar
    ? 'إذا لم يعمل الزر، انسخ هذا الرابط في متصفحك:'
    : "If the button doesn't work, copy this link into your browser:";

  const html = emailShell({
    dir: ar ? 'rtl' : 'ltr',
    bodyHtml: [greeting, body]
      .map((line) => `    <p style="color:${EMAIL_BRAND.body};">${escapeHtml(line)}</p>`)
      .join('\n'),
    cta: { label: escapeHtml(cta), url: input.portalUrl },
    fallbackNote: escapeHtml(fallback),
  });
  const text = `${greeting}\n${body}\n\n${cta}: ${input.portalUrl}\n`;
  return { subject, html, text };
}
