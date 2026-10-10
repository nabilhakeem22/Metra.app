import { describe, expect, it } from 'vitest';
import type { ActorIdentity } from '@/lib/team/display-name';
import { clientPageDetailsChangedEmailTemplate } from './client-page-details-changed';

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;

function render(locale: string, changedBy: ActorIdentity = { name: 'Nabil <admin>', email: 'nabil@studio.test' }) {
  return clientPageDetailsChangedEmailTemplate({
    changedBy,
    fields: ['studioWhatsapp', 'bankIban'],
    settingsUrl: `https://metra.test/${locale}/settings#client-page`,
    locale,
  });
}

describe('clientPageDetailsChangedEmailTemplate', () => {
  it('names the saver by their verified email, the name beside it, and the fields (en)', () => {
    const { subject, text, html } = render('en');
    expect(subject).toBe('What your clients see was changed');
    expect(text).toContain('Nabil <admin> (nabil@studio.test) changed the contact and payment details your clients see.');
    expect(text).toContain('Changed: WhatsApp, IBAN.');
    expect(text).toContain('Check the details: https://metra.test/en/settings#client-page');
    expect(html).toContain('Nabil &lt;admin&gt; (nabil@studio.test)');
    expect(html).not.toContain('<admin>');
  });

  it('with no name shows the email alone; with neither names nobody', () => {
    expect(render('en', { name: null, email: 'nabil@studio.test' }).text).toContain('nabil@studio.test changed');
    expect(render('en', { name: 'Sara', email: null }).text).toContain('Someone on your team changed');
    expect(render('ar-EG', { name: null, email: null }).text).toContain('حد من الفريق غيّر');
  });

  it('is in the studio register in Arabic, right to left, Latin digits, no dash', () => {
    const { subject, text, html } = render('ar-EG');
    expect(subject).toBe('البيانات اللي العملاء بيشوفوها اتغيّرت');
    expect(text).toContain('اللي اتغيّر: رقم الواتساب، الآيبان.');
    expect(html).toContain('dir="rtl"');
    for (const part of [subject, text, html]) {
      expect(ARABIC_INDIC.test(part)).toBe(false);
      expect(DASH.test(part)).toBe(false);
    }
  });
});
