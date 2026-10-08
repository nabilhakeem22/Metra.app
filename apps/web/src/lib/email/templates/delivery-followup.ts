// The studio's morning email about deliveries that wait on the client (Round C,
// C4). Internal: it goes to an owner or admin, never to the client (owner
// decision Q2), so it is in the studio's register (Egyptian Arabic). Western
// numerals, no cost or margin, nothing about the client but the delivery's own
// label.
import { automationEmail, type EmailContent } from './automation';

export interface DeliveryFollowupEmailInput {
  /** Each delivery's `DE-YYYY-NNNN · title` and how many days it has waited. */
  deliveries: { label: string; days: number }[];
  /** The studio's deliveries list. */
  deliveriesUrl: string;
  locale: string;
}

export function deliveryFollowupEmailTemplate(input: DeliveryFollowupEmailInput): EmailContent {
  const ar = input.locale.startsWith('ar');
  const subject = ar ? 'تسليمات مستنية رد العميل' : 'Deliveries waiting on your clients';
  const heading = ar ? 'تسليمات محتاجة متابعة' : 'Deliveries to follow up';
  const lines = input.deliveries.map(({ label, days }) =>
    ar ? `${label}: مستني العميل من ${days} يوم` : `${label}: waiting on the client for ${days} days`,
  );
  lines.push(ar ? 'ابعت للعميل تذكير من صفحة التسليم.' : 'Send the client a reminder from the delivery page.');
  const cta = { label: ar ? 'افتح التسليمات' : 'Open your deliveries', url: input.deliveriesUrl };
  return { subject, ...automationEmail(input.locale, heading, lines, cta) };
}
