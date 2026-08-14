// Bilingual internal automation emails (follow-up / digest / stage reminders).
// Server-side (no next-intl context), so copy is inlined. NEVER contains cost or
// margin, never a client address. Western numerals (§4.1).
export interface EmailContent {
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

/** Shared shell: heading + lines + a single CTA link. */
function shell(
  locale: string,
  heading: string,
  lines: string[],
  cta: { label: string; url: string },
): { html: string; text: string } {
  const dir = locale.startsWith('ar') ? 'rtl' : 'ltr';
  const body = lines
    .filter(Boolean)
    .map((l) => `<p style="color:#334155;margin:6px 0;">${escapeHtml(l)}</p>`)
    .join('');
  const html = `<!doctype html><html dir="${dir}"><body style="font-family:system-ui,-apple-system,sans-serif;background:#f4f6fb;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 8px;">Metra</h1>
    <p style="color:#0f172a;font-weight:600;">${escapeHtml(heading)}</p>
    ${body}
    <p style="margin:24px 0;">
      <a href="${cta.url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">${escapeHtml(cta.label)}</a>
    </p>
  </div></body></html>`;
  const text = `${heading}\n${lines.filter(Boolean).join('\n')}\n\n${cta.label}: ${cta.url}\n`;
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
  return { subject, ...shell(input.locale, heading, lines, cta) };
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
  return { subject, ...shell(input.locale, heading, lines, cta) };
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
  return { subject, ...shell(input.locale, heading, lines, cta) };
}
