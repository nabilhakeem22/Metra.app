import { describe, expect, it } from 'vitest';
import { deliveryReminderEmailTemplate } from './delivery-reminder';

const DASH = /[–—]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;
const LINK = 'https://metra.app/ar-EG/d/AbC_-123';

function render(locale: string, clientName = 'Ahmed', studioName = 'Diwan Studio') {
  return deliveryReminderEmailTemplate({ clientName, studioName, portalUrl: LINK, locale });
}

describe('deliveryReminderEmailTemplate', () => {
  it.each(['ar-EG', 'en'])('%s: the existing link, no dash, Latin digits', (locale) => {
    const email = render(locale);
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(DASH);
      expect(part).not.toMatch(ARABIC_INDIC_DIGIT);
    }
    expect(email.text).toContain(LINK);
    // The button and the spelled-out fallback both carry it.
    expect(email.html.split(LINK).length - 1).toBe(3);
    expect(email.subject).toContain('Diwan Studio');
    expect(email.html).toContain(locale === 'ar-EG' ? 'dir="rtl"' : 'dir="ltr"');
  });

  it('greets without a name when there is none', () => {
    expect(render('en', '  ').text.startsWith('Hello,')).toBe(true);
    expect(render('ar-EG', '').text.startsWith('مرحبًا،')).toBe(true);
  });

  it('R5: names are one capped line in the subject and the body', () => {
    const email = render('en', `Ahmed\nBcc: x${'b'.repeat(300)}`, `Diwan\r\n${'s'.repeat(5000)}`);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(Array.from(email.subject).length).toBeLessThan(160);
    expect(email.text.split('\n')[0]).toMatch(/^Hello Ahmed Bcc: xb+…,$/);
  });

  it('escapes the names, which are studio-typed text', () => {
    const email = render('en', '<img src=x>', 'A & B');
    expect(email.html).not.toContain('<img src=x>');
    expect(email.html).toContain('&lt;img src=x&gt;');
    expect(email.html).toContain('A &amp; B');
  });
});
