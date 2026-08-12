import { describe, expect, it } from 'vitest';
import { proposalSentEmailTemplate } from './proposal-sent';

describe('proposalSentEmailTemplate', () => {
  const base = {
    orgName: 'Cairo Fit-out',
    proposalNumber: 'Q-2026-0007',
    totalDisplay: 'EGP 124,000.00',
    expiryDate: '2026-09-30',
    acceptUrl: 'https://app.metra.test/ar-EG/p/tok_abc123',
    locale: 'ar-EG',
  };

  it('carries number, total, expiry and the accept link; NO cost/margin', () => {
    const { subject, html, text } = proposalSentEmailTemplate(base);
    const blob = `${subject} ${html} ${text}`;
    expect(blob).toContain('Q-2026-0007');
    expect(blob).toContain('124,000.00');
    expect(blob).toContain('2026-09-30');
    expect(html).toContain('https://app.metra.test/ar-EG/p/tok_abc123');
    // Never leaks cost or margin wording. Checked against the plain-text body
    // (the HTML's inline CSS legitimately contains the word "margin").
    const visible = `${subject} ${text}`.toLowerCase();
    expect(visible).not.toContain('cost');
    expect(visible).not.toContain('margin');
    expect(`${subject} ${text}`).not.toContain('تكلفة');
    expect(`${subject} ${text}`).not.toContain('هامش');
  });

  it('is bilingual (Arabic subject for ar, English for en) and RTL/LTR', () => {
    const ar = proposalSentEmailTemplate(base);
    expect(ar.subject).toContain('عرض سعر');
    expect(ar.html).toContain('dir="rtl"');
    const en = proposalSentEmailTemplate({ ...base, locale: 'en' });
    expect(en.subject.toLowerCase()).toContain('quotation');
    expect(en.html).toContain('dir="ltr"');
  });

  it('uses Western numerals only (no Arabic-Indic digits)', () => {
    const { subject, html, text } = proposalSentEmailTemplate(base);
    expect(/[٠-٩۰-۹]/.test(`${subject} ${html} ${text}`)).toBe(false);
  });

  it('omits the total/expiry lines when not provided', () => {
    const { html } = proposalSentEmailTemplate({
      ...base,
      totalDisplay: null,
      expiryDate: null,
    });
    expect(html).not.toContain('EGP');
    expect(html).not.toContain('2026-09-30');
  });
});
