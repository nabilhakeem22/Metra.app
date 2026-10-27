import { describe, expect, it } from 'vitest';
import type { CodePurpose } from '@/lib/client-home/code-answers';
import { clientCodeEmailTemplate } from './client-code';

const DASH = /[–—]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;
const HOME = 'https://metra.app/ar-EG/d/AbC_-123?tab=execution';

function render(locale: string, purpose: CodePurpose = 'claim_request', studioName = 'Diwan Studio') {
  return clientCodeEmailTemplate({ code: '042917', purpose, documentNumber: 'PR-2026-0007', studioName, homeUrl: HOME, locale });
}

/** Every href="…" value in the document. */
const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

describe('clientCodeEmailTemplate', () => {
  it.each(['ar-EG', 'en'])('%s: the code in plain text in the subject and body, no dash, Latin digits', (locale) => {
    const email = render(locale);
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toMatch(DASH);
      expect(part).not.toMatch(ARABIC_INDIC_DIGIT);
    }
    expect(email.subject).toContain('042917');
    expect(email.text).toContain('042917');
    expect(email.html).toContain('>042917</p>');
    expect(email.text).toContain('PR-2026-0007');
    expect(email.text).toContain('Diwan Studio');
    expect(email.text).toContain('10');
    expect(email.html).toContain(locale === 'ar-EG' ? 'dir="rtl"' : 'dir="ltr"');
  });

  it('the client copy is فصحى: the subject and the warning in the client register', () => {
    const email = render('ar-EG');
    expect(email.subject).toBe('رمز التحقق: 042917');
    expect(email.text).toContain('لتأكيد إبلاغك بسداد مطالبة الدفع PR-2026-0007');
    expect(email.text).toContain('إن لم تطلب هذا الرمز فتجاهل هذه الرسالة وأبلغ Diwan Studio.');
  });

  it('names a design instalment by its delivery', () => {
    const email = clientCodeEmailTemplate({
      code: '123456',
      purpose: 'claim_design_payment',
      documentNumber: 'DE-2026-0012',
      studioName: 'Diwan',
      homeUrl: HOME,
      locale: 'en',
    });
    expect(email.text).toContain('to confirm that you paid a design fee instalment on DE-2026-0012');
  });

  it('names the execution contract a signing code is for, in both registers', () => {
    const sign = (locale: string) =>
      clientCodeEmailTemplate({ code: '123456', purpose: 'sign_contract', documentNumber: 'C-2026-0004', studioName: 'Diwan', homeUrl: HOME, locale });
    expect(sign('ar-EG').text).toContain('لتوقيع عقد التنفيذ C-2026-0004');
    expect(sign('en').text).toContain('to sign execution contract C-2026-0004');
    for (const locale of ['ar-EG', 'en']) expect(sign(locale).text).not.toMatch(DASH);
  });

  it('links only to the client\'s own project page', () => {
    for (const locale of ['ar-EG', 'en']) {
      expect(hrefsOf(render(locale).html)).toEqual([HOME.replace('&', '&amp;')]);
      expect(render(locale).text.match(/https?:\/\/\S+/g)).toEqual([HOME]);
    }
  });

  it('the studio name is one capped line, escaped', () => {
    const email = render('en', 'claim_request', `<img src=x>\r\nBcc: x${'s'.repeat(300)}`);
    expect(email.html).not.toContain('<img src=x>');
    expect(email.html).toContain('&lt;img src=x&gt;');
    expect(email.text.split('\n')[0]).not.toMatch(/[\r]/);
    expect(email.text).toContain('…');
  });
});
