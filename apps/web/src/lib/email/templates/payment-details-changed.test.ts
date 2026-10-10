import { describe, expect, it } from 'vitest';
import { paymentDetailsChangedEmailTemplate } from './payment-details-changed';

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;

function render(locale: string, changedBy: string | null = 'Nabil <admin>') {
  return paymentDetailsChangedEmailTemplate({
    changedBy,
    fields: ['bankAccountNumber', 'bankIban'],
    settingsUrl: `https://metra.test/${locale}/settings#client-page`,
    locale,
  });
}

describe('paymentDetailsChangedEmailTemplate', () => {
  it('says who changed which fields and links to the card (en)', () => {
    const { subject, text, html } = render('en');
    expect(subject).toBe("Your studio's payment details were changed");
    expect(text).toContain('Nabil <admin> changed the payment details your clients see.');
    expect(text).toContain('Changed: account number, IBAN.');
    expect(text).toContain('Check the payment details: https://metra.test/en/settings#client-page');
    expect(html).toContain('Nabil &lt;admin&gt;');
    expect(html).not.toContain('<admin>');
  });

  it('names nobody when the name is unknown', () => {
    expect(render('en', null).text).toContain('Someone on your team changed');
    expect(render('en', '  ').text).toContain('Someone on your team changed');
    expect(render('ar-EG', null).text).toContain('حد من الفريق غيّر');
  });

  it('is in the studio register in Arabic, right to left, Latin digits, no dash', () => {
    const { subject, text, html } = render('ar-EG');
    expect(subject).toBe('بيانات الدفع بتاعة الاستوديو اتغيّرت');
    expect(text).toContain('اللي اتغيّر: رقم الحساب، الآيبان.');
    expect(html).toContain('dir="rtl"');
    for (const part of [subject, text, html]) {
      expect(ARABIC_INDIC.test(part)).toBe(false);
      expect(DASH.test(part)).toBe(false);
    }
  });
});
