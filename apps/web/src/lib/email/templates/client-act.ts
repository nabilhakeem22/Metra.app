// "The client just acted on a delivery": the email the studio's members get
// with a NEW in-app notification (lib/engagements/client-acts). Server-side, no
// next-intl context, so the copy is inlined like the other templates. STUDIO
// register: Egyptian Arabic, like every studio surface. Latin digits, no dash.
// It carries what happened and where to look, never the client's note: the
// studio reads that in the app, behind its own login.
import { EMAIL_BRAND } from '@/lib/email/brand';
import type { ClientAct, ClientActKind } from '@/lib/engagements/client-acts/acts';
import { escapeHtml } from '@/lib/html/escape';
import type { EmailContent } from './automation';
import { emailShell } from './shell';

export interface ClientActEmailInput {
  act: ClientAct;
  /** `DE-YYYY-NNNN · title`, or '' when the delivery could not be read. */
  deliveryLabel: string;
  deliveryUrl: string;
  locale: string;
}

type Copy = Record<'ar' | 'en', string>;

/** What the client did, as one sentence. */
const ACT_LINE: Record<Exclude<ClientActKind, 'payment_claimed'>, Copy> = {
  concept_approved: {
    ar: 'العميل وافق على التصميم المبدئي.',
    en: 'The client approved the concept.',
  },
  concept_chosen: {
    ar: 'العميل اختار فكرة من الأفكار المبدئية.',
    en: 'The client chose one of the concept options.',
  },
  concept_changes_requested: {
    ar: 'العميل طلب تعديلات على التصميم المبدئي.',
    en: 'The client asked for changes to the concept.',
  },
  design_approved: {
    ar: 'العميل وافق على التصميم النهائي.',
    en: 'The client approved the final design.',
  },
  design_changes_requested: {
    ar: 'العميل طلب تعديلات على التصميم النهائي.',
    en: 'The client asked for changes to the final design.',
  },
  budget_acknowledged: {
    ar: 'العميل أكّد إنه اطّلع على الميزانية التقديرية.',
    en: 'The client acknowledged the estimated budget.',
  },
  handover_acknowledged: {
    ar: 'العميل أكّد استلام حزمة التصميم.',
    en: 'The client confirmed they received the design package.',
  },
  commented: {
    ar: 'العميل بعت رسالة على ملف من ملفات التسليم.',
    en: 'The client sent a message on one of the delivery files.',
  },
};

/** The milestone names, as the studio's own screens call them. */
const MILESTONE_NAME: Record<string, Copy> = {
  deposit: { ar: 'العربون', en: 'the deposit' },
  gate_a: { ar: 'دفعة الفكرة', en: 'the concept payment' },
  gate_b: { ar: 'الدفعة الأولى', en: 'the first payment' },
  balance: { ar: 'الدفعة الأخيرة', en: 'the final payment' },
};

function actLine(act: ClientAct, lang: 'ar' | 'en'): string {
  if (act.kind !== 'payment_claimed') return ACT_LINE[act.kind][lang];
  const milestone = MILESTONE_NAME[act.milestoneKind ?? '']?.[lang];
  if (lang === 'ar') {
    return milestone
      ? `العميل بيقول إنه دفع ${milestone}. أكّد الدفعة لما توصلك.`
      : 'العميل بيقول إنه دفع دفعة. أكّد الدفعة لما توصلك.';
  }
  return milestone
    ? `The client says they paid ${milestone}. Confirm it once it reaches you.`
    : 'The client says they made a payment. Confirm it once it reaches you.';
}

export function clientActEmailTemplate(input: ClientActEmailInput): EmailContent {
  const lang = input.locale.startsWith('ar') ? 'ar' : 'en';
  const label = input.deliveryLabel.trim();
  const subject =
    lang === 'ar'
      ? label
        ? `رد من العميل على ${label}`
        : 'رد جديد من العميل'
      : label
        ? `The client responded on ${label}`
        : 'A new response from the client';
  const heading = lang === 'ar' ? 'العميل رد على التسليم' : 'The client responded';
  const lines = [actLine(input.act, lang), label];
  const cta = { label: lang === 'ar' ? 'افتح التسليم' : 'Open the delivery', url: input.deliveryUrl };

  const shown = lines.filter(Boolean);
  const bodyHtml = shown
    .map((line) => `    <p style="color:${EMAIL_BRAND.body};margin:6px 0;">${escapeHtml(line)}</p>`)
    .join('\n');
  const html = emailShell({
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    heading,
    bodyHtml,
    // A fixed literal, escaped all the same (the shell does not escape labels).
    cta: { label: escapeHtml(cta.label), url: cta.url },
  });
  const text = `${heading}\n${shown.join('\n')}\n\n${cta.label}: ${cta.url}\n`;
  return { subject, html, text };
}
