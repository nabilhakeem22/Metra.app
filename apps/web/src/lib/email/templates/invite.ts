// Bilingual invite email. Server-side (no next-intl context), so copy is inlined.
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  const html = `<!doctype html><html dir="${dir}"><body style="font-family:system-ui,-apple-system,sans-serif;background:#f4f6fb;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 8px;">Metra</h1>
    <p style="color:#334155;">${intro}</p>
    <p style="margin:24px 0;">
      <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">${cta}</a>
    </p>
    <p style="color:#64748b;font-size:13px;">${fallback}</p>
    <p style="word-break:break-all;font-size:13px;"><a href="${url}">${url}</a></p>
  </div></body></html>`;

  const text = `${intro}\n\n${cta}: ${url}\n`;

  return { subject, html, text };
}
