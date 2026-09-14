// Bilingual internal automation emails (follow-up / digest / stage reminders).
// Server-side (no next-intl context), so copy is inlined. NEVER contains cost or
// margin, never a client address. Western numerals (§4.1).
import { EMAIL_BRAND } from '@/lib/email/brand';
import { escapeHtml } from '@/lib/html/escape';
import { emailShell } from './shell';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * An internal automation email: a heading, some plain lines, one CTA. No
 * fallback link block — these go to the studio's own inbox, not a client's, and
 * the button has never been the only way in.
 */
function automationEmail(
  locale: string,
  heading: string,
  lines: string[],
  cta: { label: string; url: string },
): { html: string; text: string } {
  const shown = lines.filter(Boolean);
  const body = shown
    .map((l) => `<p style="color:${EMAIL_BRAND.body};margin:6px 0;">${escapeHtml(l)}</p>`)
    .join('');
  const html = emailShell({
    dir: locale.startsWith('ar') ? 'rtl' : 'ltr',
    heading,
    bodyHtml: `    ${body}`,
    // These labels are fixed literals, but they are escaped here because this
    // family always did, and the shell deliberately does not escape for anyone.
    cta: { label: escapeHtml(cta.label), url: cta.url },
  });
  const text = `${heading}\n${shown.join('\n')}\n\n${cta.label}: ${cta.url}\n`;
  return { html, text };
}

export function followupReminderEmailTemplate(input: {
  proposalNumber: string;
  days: number;
  reviewUrl: string;
  locale: string;
}): EmailContent {
  const ar = input.locale.startsWith('ar');
  const subject = ar
    ? `متابعة عرض السعر ${input.proposalNumber}`
    : `Follow up on quotation ${input.proposalNumber}`;
  const heading = ar
    ? `عرض السعر ${input.proposalNumber} بانتظار الرد`
    : `Quotation ${input.proposalNumber} is awaiting a response`;
  const lines = [
    ar
      ? `مضى ${input.days} يومًا دون رد. قد ترغب في متابعة العميل.`
      : `It's been ${input.days} days with no response. You may want to follow up.`,
  ];
  const cta = {
    label: ar ? 'عرض العرض' : 'View the quotation',
    url: input.reviewUrl,
  };
  return { subject, ...automationEmail(input.locale, heading, lines, cta) };
}

export function digestEmailTemplate(input: {
  activeProjects: number;
  awaitingResponse: number;
  expiringSoon: number;
  overdueStages: number;
  dashboardUrl: string;
  locale: string;
}): EmailContent {
  const ar = input.locale.startsWith('ar');
  const subject = ar ? 'ملخص محفظتك على ميترا' : 'Your Metra portfolio digest';
  const heading = ar ? 'ملخص المحفظة' : 'Portfolio digest';
  const lines = ar
    ? [
        `المشاريع النشطة: ${input.activeProjects}`,
        `عروض بانتظار الرد: ${input.awaitingResponse}`,
        `عروض تنتهي قريبًا: ${input.expiringSoon}`,
        `مراحل متأخرة: ${input.overdueStages}`,
      ]
    : [
        `Active projects: ${input.activeProjects}`,
        `Awaiting response: ${input.awaitingResponse}`,
        `Expiring soon: ${input.expiringSoon}`,
        `Overdue stages: ${input.overdueStages}`,
      ];
  const cta = {
    label: ar ? 'فتح لوحة التحكم' : 'Open dashboard',
    url: input.dashboardUrl,
  };
  return { subject, ...automationEmail(input.locale, heading, lines, cta) };
}

export function stageReminderEmailTemplate(input: {
  overdueCount: number;
  upcomingCount: number;
  projectsUrl: string;
  locale: string;
}): EmailContent {
  const ar = input.locale.startsWith('ar');
  const subject = ar ? 'تذكير بمراحل المشاريع' : 'Project stage reminders';
  const heading = ar ? 'مراحل تحتاج إلى انتباه' : 'Stages needing attention';
  const lines = ar
    ? [
        `مراحل متأخرة: ${input.overdueCount}`,
        `مراحل تنتهي قريبًا: ${input.upcomingCount}`,
      ]
    : [
        `Overdue stages: ${input.overdueCount}`,
        `Upcoming stages: ${input.upcomingCount}`,
      ];
  const cta = {
    label: ar ? 'فتح المشاريع' : 'Open projects',
    url: input.projectsUrl,
  };
  return { subject, ...automationEmail(input.locale, heading, lines, cta) };
}
