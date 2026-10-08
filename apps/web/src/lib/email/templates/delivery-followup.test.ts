import { describe, expect, it } from 'vitest';
import { deliveryFollowupEmailTemplate } from './delivery-followup';

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;

function render(locale: string) {
  return deliveryFollowupEmailTemplate({
    deliveries: [
      { label: 'DE-2026-0012 · Villa <kitchen>', days: 6 },
      { label: 'DE-2026-0015 · شقة الزمالك', days: 11 },
    ],
    deliveriesUrl: 'https://metra.test/en/engagements',
    locale,
  });
}

describe('deliveryFollowupEmailTemplate', () => {
  it('lists each delivery with its days and links to the deliveries list (en)', () => {
    const { subject, text, html } = render('en');
    expect(subject).toBe('Deliveries waiting on your clients');
    expect(text).toContain('DE-2026-0012 · Villa <kitchen>: waiting on the client for 6 days');
    expect(text).toContain('DE-2026-0015 · شقة الزمالك: waiting on the client for 11 days');
    expect(text).toContain('Open your deliveries: https://metra.test/en/engagements');
    expect(html).toContain('Villa &lt;kitchen&gt;');
    expect(html).not.toContain('<kitchen>');
    expect(html).toContain('dir="ltr"');
  });

  it('is in the studio register in Arabic, right to left, Latin digits, no dash', () => {
    const { subject, text, html } = render('ar-EG');
    expect(subject).toBe('تسليمات مستنية رد العميل');
    expect(text).toContain('DE-2026-0012 · Villa <kitchen>: مستني العميل من 6 يوم');
    expect(text).toContain('افتح التسليمات');
    expect(html).toContain('dir="rtl"');
    for (const part of [subject, text, html]) {
      expect(ARABIC_INDIC.test(part)).toBe(false);
      expect(DASH.test(part)).toBe(false);
    }
  });
});
