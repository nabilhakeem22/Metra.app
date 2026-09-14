import { describe, expect, it } from 'vitest';
import { followupReminderEmailTemplate } from './automation';
import { inviteEmailTemplate } from './invite';
import { proposalSentEmailTemplate } from './proposal-sent';

// The three templates interpolate a caller-supplied URL into href="...". The
// escaper itself is proved in lib/html/escape.test.ts; what is proved HERE is
// that every template actually applies it to the URL — two of them once did not.
// A URL carrying the one character that ends a double-quoted attribute, plus
// markup that would run if it ever reached the document unescaped.
const HOSTILE_URL =
  'https://app.metra.test/p/tok" onmouseover="steal()" x="';

/** Every href="…" value in the document. */
function hrefValues(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
}

describe('a hostile URL never ends the href attribute', () => {
  const cases = [
    {
      name: 'invite',
      html: inviteEmailTemplate({
        orgName: 'Cairo Fit-out',
        acceptUrl: HOSTILE_URL,
        role: 'admin',
        locale: 'en',
      }).html,
    },
    {
      name: 'proposal-sent',
      html: proposalSentEmailTemplate({
        orgName: 'Cairo Fit-out',
        proposalNumber: 'Q-2026-0007',
        totalDisplay: 'EGP 1.00',
        expiryDate: '2026-09-30',
        acceptUrl: HOSTILE_URL,
        locale: 'en',
      }).html,
    },
    {
      name: 'automation',
      html: followupReminderEmailTemplate({
        proposalNumber: 'Q-2026-0007',
        days: 3,
        reviewUrl: HOSTILE_URL,
        locale: 'en',
      }).html,
    },
  ];

  it.each(cases)('$name keeps every href a single attribute', ({ html }) => {
    const hrefs = hrefValues(html);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      // A raw quote would have terminated the attribute early, so the captured
      // value would be a truncated prefix and the rest would be live markup.
      expect(href).toContain('&quot;');
    }
    expect(html).not.toContain('onmouseover="steal()"');
  });
});

describe('plain-text bodies keep their links verbatim', () => {
  it('an ampersand in a text-body link is not turned into an entity', () => {
    // There is no markup in a text/plain part, so an escaped URL there is just
    // a broken link. Only the href in the HTML part is escaped.
    const { text } = inviteEmailTemplate({
      orgName: 'Cairo Fit-out',
      acceptUrl: 'https://app.metra.test/p/tok?a=1&b=2',
      role: 'admin',
      locale: 'en',
    });
    expect(text).toContain('https://app.metra.test/p/tok?a=1&b=2');
    expect(text).not.toContain('&amp;');
  });
});
