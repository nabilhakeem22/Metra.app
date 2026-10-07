import { describe, expect, it } from 'vitest';
import type { ClientAct } from '@/lib/engagements/client-acts/acts';
import { clientActEmailTemplate } from './client-act';

const ACTS: ClientAct[] = [
  { kind: 'concept_approved' },
  { kind: 'concept_chosen' },
  { kind: 'concept_changes_requested' },
  { kind: 'design_approved' },
  { kind: 'design_changes_requested' },
  { kind: 'budget_acknowledged' },
  { kind: 'handover_acknowledged' },
  { kind: 'payment_claimed', milestoneKind: 'gate_b' },
  { kind: 'commented' },
];

const DASH = /[–—]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

function render(act: ClientAct, locale: string, deliveryLabel = 'DE-2026-0012 · Villa') {
  return clientActEmailTemplate({
    act,
    deliveryLabel,
    deliveryUrl: 'https://metra.app/ar-EG/engagements/11111111-1111-4111-8111-111111111111',
    locale,
  });
}

describe('clientActEmailTemplate', () => {
  it.each(ACTS.flatMap((act) => ['ar-EG', 'en'].map((locale) => [act.kind, locale, act] as const)))(
    '%s in %s: no dash, Latin digits, the delivery and its link',
    (_kind, locale, act) => {
      const email = render(act, locale);
      for (const part of [email.subject, email.html, email.text]) {
        expect(part).not.toMatch(DASH);
        expect(part).not.toMatch(ARABIC_INDIC_DIGIT);
      }
      expect(email.subject).toContain('DE-2026-0012');
      expect(email.text).toContain('/engagements/11111111-1111-4111-8111-111111111111');
      expect(email.html).toContain(locale === 'ar-EG' ? 'dir="rtl"' : 'dir="ltr"');
    },
  );

  it('names the milestone of a payment claim in both locales', () => {
    const act: ClientAct = { kind: 'payment_claimed', milestoneKind: 'gate_b' };
    expect(render(act, 'en').text).toContain('the first payment');
    expect(render(act, 'ar-EG').text).toContain('الدفعة الأولى');
  });

  it('still reads without a delivery label', () => {
    const email = render({ kind: 'design_approved' }, 'en', '');
    expect(email.subject).toBe('A new response from the client');
    expect(email.text).toContain('The client approved the final design.');
  });

  it('escapes the delivery title, which is studio-typed text', () => {
    const email = render({ kind: 'commented' }, 'en', 'DE-2026-0001 · <b>Villa</b>');
    expect(email.html).not.toContain('<b>Villa</b>');
    expect(email.html).toContain('&lt;b&gt;Villa&lt;/b&gt;');
  });
});
