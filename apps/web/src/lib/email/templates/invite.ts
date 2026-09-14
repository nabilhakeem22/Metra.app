// Bilingual invite email. Server-side (no next-intl context), so copy is inlined.
import { EMAIL_BRAND } from '@/lib/email/brand';
import { escapeHtml } from '@/lib/html/escape';
import { emailShell } from './shell';

export interface InviteEmailContent {
  subject: string;
  html: string;
  text: string;
}

const ROLE_LABEL: Record<string, { en: string; ar: string }> = {
  owner: { en: 'Owner', ar: 'مالك' },
  admin: { en: 'Admin', ar: 'مسؤول' },
  project_manager: { en: 'Project Manager', ar: 'مدير مشروع' },
  site_engineer: { en: 'Site Engineer', ar: 'مهندس موقع' },
  accountant: { en: 'Accountant', ar: 'محاسب' },
  client: { en: 'Client', ar: 'عميل' },
  viewer: { en: 'Viewer', ar: 'مشاهد' },
};

export function inviteEmailTemplate(input: {
  orgName: string;
  acceptUrl: string;
  role: string;
  locale: string;
}): InviteEmailContent {
  const ar = input.locale.startsWith('ar');
  const dir = ar ? 'rtl' : 'ltr';
  const org = escapeHtml(input.orgName);
  const url = input.acceptUrl;
  const roleLabel = (ROLE_LABEL[input.role] ?? { en: input.role, ar: input.role })[
    ar ? 'ar' : 'en'
  ];

  const subject = ar
    ? `دعوة للانضمام إلى ${input.orgName} على ميترا`
    : `You're invited to join ${input.orgName} on Metra`;

  const intro = ar
    ? `تمت دعوتك للانضمام إلى «${org}» على ميترا بصفة ${escapeHtml(roleLabel)}.`
    : `You've been invited to join "${org}" on Metra as ${escapeHtml(roleLabel)}.`;

  const cta = ar ? 'قبول الدعوة' : 'Accept invitation';
  const fallback = ar
    ? 'إذا لم يعمل الزر، انسخ هذا الرابط في متصفحك:'
    : "If the button doesn't work, copy this link into your browser:";

  const html = emailShell({
    dir,
    bodyHtml: `    <p style="color:${EMAIL_BRAND.body};">${intro}</p>`,
    cta: { label: cta, url },
    fallbackNote: fallback,
  });

  const text = `${intro}\n\n${cta}: ${url}\n`;

  return { subject, html, text };
}
