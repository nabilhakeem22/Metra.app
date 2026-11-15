// CHARACTERIZATION of proposalSentEmailTemplate: the subject, the HTML body and
// the plain-text body of the "your proposal is ready" email, byte for byte, in
// both languages. Written against the template as it stood BEFORE the layout of
// its two bodies was named, and not edited since: a refactor that changes a
// word, a space, a line break, an escape, which optional line prints, the order
// of the lines, the order of the returned keys or the error for a bad input
// fails here.
//
// Three layers. Named scenarios compare the subject, the body and the text
// against literals. One whole HTML document is compared against a golden file
// (proposal-sent.golden.en.html). A generated grid (one factor at a time,
// English with every value, every total with every expiry in both languages,
// 300 seeded random cases, and every named input) is compared by digest
// (proposal-sent.golden-digests.json). Every golden and digest is the unsplit
// template's own output.
//
// No module is doubled: the real shell and the real escaper run.
import { describe, expect, it } from 'vitest';
import { baseOf, digestOf, oneFactorAtATime, randomCases, readGolden, type ChoiceOf } from '@/test/golden-cases';
import { ABSENT } from '@/test/priced-document-cases';
import { proposalSentEmailTemplate } from './proposal-sent';
import recorded from './proposal-sent.golden-digests.json';

type TemplateInput = Parameters<typeof proposalSentEmailTemplate>[0];

const TOTALS = ['EGP 124,000.00', ABSENT, undefined, null, '', ' ', '1,240.00 ج.م', '<b>5</b> & "6"', '0', 0, 12.5, false];
const EXPIRIES = ['2026-09-30', ABSENT, undefined, null, '', ' ', '2027-01-15', "<i>soon</i> & 'later'", '0', 0, 20260930, false];
// The FIRST value of each pool is the base (so the base is Arabic).
const POOLS = {
  locale: ['ar-EG', 'en', 'ar', 'fr', 'AR-eg', ''],
  orgName: ['Cairo Fit-out', 'Hassan & Sons', 'استوديو النيل', '', '<script>x</script>', "O'Brien \"Design\""],
  proposalNumber: ['Q-2026-0007', 'Q-2027-0123', '', '<Q&7>'],
  totalDisplay: TOTALS,
  expiryDate: EXPIRIES,
  acceptUrl: [
    'https://app.metra.test/ar-EG/p/tok_abc123',
    'https://app.metra.test/p/tok?a=1&b=2',
    '',
    'https://app.metra.test/p/tok" onmouseover="steal()" x="',
  ],
};
type Choice = ChoiceOf<typeof POOLS>;

const BASE = baseOf(POOLS);

/** What the caller passes: its whole input, `to` included. A choice of ABSENT leaves the key off. */
function inputOf(choice: Choice): Record<string, unknown> {
  const input: Record<string, unknown> = {
    orgName: choice.orgName,
    proposalNumber: choice.proposalNumber,
    acceptUrl: choice.acceptUrl,
    locale: choice.locale,
    to: 'client@example.test',
  };
  if (choice.totalDisplay !== ABSENT) input.totalDisplay = choice.totalDisplay;
  if (choice.expiryDate !== ABSENT) input.expiryDate = choice.expiryDate;
  return input;
}

/** One call: its id and the input it is made with, built fresh. */
interface Run {
  id: string;
  input: () => unknown;
}

const emailOf = (run: Run) => proposalSentEmailTemplate(run.input() as TemplateInput);

/** Everything a caller can observe: the keys in order and the three parts, or `THROWN <the error's class>`. */
function outputOf(run: Run): string {
  try {
    const email = emailOf(run);
    return 'keys ' + Object.keys(email).join(',') + '\nSUBJECT ' + email.subject + '\nHTML ' + email.html + '\nTEXT ' + email.text;
  } catch (thrown) {
    return 'THROWN ' + (thrown as Error).constructor.name;
  }
}

const ofChoice = (id: string, choice: Choice): Run => ({ id, input: () => inputOf(choice) });
const withBase = (id: string, changes: Partial<Choice>): Run => ofChoice(id, { ...BASE, ...changes });
const inEnglish = (id: string, changes: Partial<Choice> = {}): Run => withBase(id, { locale: 'en', ...changes });

// ---------------------------------------------------------------- named inputs

const E_T1 = inEnglish('E-T1/en-both-lines');
const E_T2 = withBase('E-T2/ar-both-lines', {});

/** The four ways a line is not given: the key absent, undefined, null, the empty string. */
const NOT_GIVEN = [ABSENT, undefined, null, ''];
const E_T3 = {
  neither: NOT_GIVEN.flatMap((totalDisplay, t) =>
    NOT_GIVEN.map((expiryDate, e) => inEnglish(`E-T3/neither/${t}/${e}`, { totalDisplay, expiryDate })),
  ),
  totalOnly: inEnglish('E-T3/total-only', { expiryDate: null }),
  expiryOnly: inEnglish('E-T3/expiry-only', { totalDisplay: null }),
  both: inEnglish('E-T3/both'),
  blank: inEnglish('E-T3/blank', { totalDisplay: ' ', expiryDate: ' ' }),
};

const E_T4 = {
  ampersandOrg: inEnglish('E-T4/org-ampersand', { orgName: 'Hassan & Sons' }),
  markupNumber: inEnglish('E-T4/number-markup', { proposalNumber: '<Q&7>' }),
  hostileLines: inEnglish('E-T4/hostile-lines', { totalDisplay: '<b>5</b> & "6"', expiryDate: "<i>soon</i> & 'later'" }),
  ampersandUrl: inEnglish('E-T4/url-ampersand', { acceptUrl: 'https://app.metra.test/p/tok?a=1&b=2' }),
  hostileUrl: inEnglish('E-T4/url-hostile', { acceptUrl: 'https://app.metra.test/p/tok" onmouseover="steal()" x="' }),
};

const E_T5 = POOLS.locale.map((locale, i) => withBase(`E-T5/locale/${i}`, { locale }));

const broken = (id: string, input: () => unknown): Run => ({ id: `bad/${id}`, input });
const withInput = (id: string, over: Record<string, unknown>) => broken(id, () => ({ ...inputOf(BASE), ...over }));
const E_T6 = [
  broken('input-null', () => null),
  broken('input-undefined', () => undefined),
  broken('input-empty', () => ({})),
  withInput('locale-undefined', { locale: undefined }),
  withInput('locale-number', { locale: 7 }),
  withInput('orgName-undefined', { orgName: undefined }),
  withInput('orgName-null', { orgName: null }),
  withInput('proposalNumber-number', { proposalNumber: 7 }),
  withInput('acceptUrl-undefined', { acceptUrl: undefined }),
  withInput('acceptUrl-null', { acceptUrl: null }),
  withInput('totalDisplay-number', { totalDisplay: 5 }),
  withInput('expiryDate-number', { expiryDate: 5 }),
];

// ------------------------------------------------------------------- the grid

const pairEn = Object.entries(POOLS).flatMap(([key, pool]) =>
  pool.map((value, i) => ofChoice(`pair/en/${key}/${i}`, { ...BASE, locale: 'en', [key]: value } as Choice)),
);
const everyLinePair = ['ar-EG', 'en'].flatMap((locale) =>
  TOTALS.flatMap((totalDisplay, t) =>
    EXPIRIES.map((expiryDate, e) => withBase(`lines/${locale}/${t}/${e}`, { locale, totalDisplay, expiryDate })),
  ),
);

const RUNS: Run[] = [
  ...oneFactorAtATime(POOLS).map(({ id, choice }) => ofChoice(id, choice)),
  ...pairEn,
  ...everyLinePair,
  ...randomCases(POOLS, 20261119, 300).map(({ id, choice }) => ofChoice(id, choice)),
  E_T1,
  E_T2,
  ...E_T3.neither,
  E_T3.totalOnly,
  E_T3.expiryOnly,
  E_T3.both,
  E_T3.blank,
  ...Object.values(E_T4),
  ...E_T5,
  ...E_T6,
];

// --------------------------------------------------------------- reading an email

/** What the template puts between the wordmark and the button: its own paragraphs. */
function bodyOf(html: string): string {
  const open = '</h1>\n';
  const close = '\n    <p style="margin:24px 0;">';
  const start = html.indexOf(open);
  const end = html.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error('no body between the wordmark and the button');
  return html.slice(start + open.length, end);
}
const hrefsOf = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);

const EN_INTRO = '"Cairo Fit-out" has sent you quotation Q-2026-0007 for review.';
const EN_INTRO_PARAGRAPH = `    <p style="color:#333A44;">${EN_INTRO}</p>`;
const EN_LINK = 'View & respond to the quote: https://app.metra.test/ar-EG/p/tok_abc123';
const optionalParagraph = (line: string) => `<p style="color:#333A44;margin:4px 0;" dir="ltr">${line}</p>`;

// ------------------------------------------------------------------ the tests

describe('proposalSentEmailTemplate, the whole email', () => {
  it('E-T1: English with both lines: the keys in order, the subject, the golden HTML and the text', () => {
    const email = emailOf(E_T1);
    expect(Object.keys(email)).toEqual(['subject', 'html', 'text']);
    expect(email.subject).toBe('Quotation Q-2026-0007 from Cairo Fit-out');
    expect(email.html).toBe(readGolden(new URL('./proposal-sent.golden.en.html', import.meta.url)));
    expect(email.text).toBe([EN_INTRO, 'Total: EGP 124,000.00', 'Valid until 2026-09-30', '', EN_LINK, ''].join('\n'));
  });

  it('E-T2: Arabic with both lines: right to left, the two optional paragraphs on ONE line, each left to right', () => {
    const email = emailOf(E_T2);
    expect(Object.keys(email)).toEqual(['subject', 'html', 'text']);
    expect(email.subject).toBe('عرض سعر Q-2026-0007 من Cairo Fit-out');
    expect(email.html.startsWith('<!doctype html><html dir="rtl"><body ')).toBe(true);
    expect(bodyOf(email.html)).toBe(
      [
        '    <p style="color:#333A44;">أرسلت إليك «Cairo Fit-out» عرض السعر Q-2026-0007 للاطلاع.</p>',
        `    ${optionalParagraph('الإجمالي: EGP 124,000.00')}${optionalParagraph('صالح حتى 2026-09-30')}`,
      ].join('\n'),
    );
    expect(email.text).toBe(
      [
        'أرسلت إليك «Cairo Fit-out» عرض السعر Q-2026-0007 للاطلاع.',
        'الإجمالي: EGP 124,000.00',
        'صالح حتى 2026-09-30',
        '',
        'عرض العرض والرد عليه: https://app.metra.test/ar-EG/p/tok_abc123',
        '',
      ].join('\n'),
    );
  });

  it('digests as recorded for every case of the grid', () => {
    expect(new Set(RUNS.map((run) => run.id)).size).toBe(RUNS.length);
    const digests = Object.fromEntries(RUNS.map((run) => [run.id, digestOf(outputOf(run))]));
    expect(digests).toEqual(recorded);
  });
});

describe('proposalSentEmailTemplate, the optional lines', () => {
  it('E-T3: prints neither when each is absent, undefined, null or empty: the body ends in a line of four spaces', () => {
    expect(E_T3.neither).toHaveLength(16);
    for (const run of E_T3.neither) {
      const email = emailOf(run);
      expect([run.id, bodyOf(email.html)]).toEqual([run.id, `${EN_INTRO_PARAGRAPH}\n    `]);
      expect([run.id, email.text]).toEqual([run.id, [EN_INTRO, '', EN_LINK, ''].join('\n')]);
    }
  });

  it('E-T3: prints the total alone, the expiry alone, and both in that order', () => {
    const totalOnly = emailOf(E_T3.totalOnly);
    expect(bodyOf(totalOnly.html)).toBe(`${EN_INTRO_PARAGRAPH}\n    ${optionalParagraph('Total: EGP 124,000.00')}`);
    expect(totalOnly.text).toBe([EN_INTRO, 'Total: EGP 124,000.00', '', EN_LINK, ''].join('\n'));

    const expiryOnly = emailOf(E_T3.expiryOnly);
    expect(bodyOf(expiryOnly.html)).toBe(`${EN_INTRO_PARAGRAPH}\n    ${optionalParagraph('Valid until 2026-09-30')}`);
    expect(expiryOnly.text).toBe([EN_INTRO, 'Valid until 2026-09-30', '', EN_LINK, ''].join('\n'));

    const both = emailOf(E_T3.both);
    expect(bodyOf(both.html)).toBe(
      `${EN_INTRO_PARAGRAPH}\n    ${optionalParagraph('Total: EGP 124,000.00')}${optionalParagraph('Valid until 2026-09-30')}`,
    );
    expect(both.text).toBe([EN_INTRO, 'Total: EGP 124,000.00', 'Valid until 2026-09-30', '', EN_LINK, ''].join('\n'));
  });

  it('E-T3: prints a label and a space for a line that is one space', () => {
    const blank = emailOf(E_T3.blank);
    expect(bodyOf(blank.html)).toBe(`${EN_INTRO_PARAGRAPH}\n    ${optionalParagraph('Total:  ')}${optionalParagraph('Valid until  ')}`);
    expect(blank.text).toBe([EN_INTRO, 'Total:  ', 'Valid until  ', '', EN_LINK, ''].join('\n'));
  });
});

describe('proposalSentEmailTemplate, escaping', () => {
  it('E-T4: keeps the studio name raw in the subject and escapes it in the HTML intro AND in the text intro', () => {
    const email = emailOf(E_T4.ampersandOrg);
    expect(email.subject).toBe('Quotation Q-2026-0007 from Hassan & Sons');
    expect(bodyOf(email.html).split('\n')[0]).toBe(
      '    <p style="color:#333A44;">"Hassan &amp; Sons" has sent you quotation Q-2026-0007 for review.</p>',
    );
    // Today's behaviour: the plain-text body carries the entity too.
    expect(email.text.split('\n')[0]).toBe('"Hassan &amp; Sons" has sent you quotation Q-2026-0007 for review.');
  });

  it('E-T4: keeps the number raw in the subject and escapes it in the intro', () => {
    const email = emailOf(E_T4.markupNumber);
    expect(email.subject).toBe('Quotation <Q&7> from Cairo Fit-out');
    expect(bodyOf(email.html).split('\n')[0]).toBe(
      '    <p style="color:#333A44;">"Cairo Fit-out" has sent you quotation &lt;Q&amp;7&gt; for review.</p>',
    );
    expect(email.text.split('\n')[0]).toBe('"Cairo Fit-out" has sent you quotation &lt;Q&amp;7&gt; for review.');
  });

  it('E-T4: escapes the total and the expiry in the HTML and in the text', () => {
    const email = emailOf(E_T4.hostileLines);
    const total = 'Total: &lt;b&gt;5&lt;/b&gt; &amp; &quot;6&quot;';
    const expiry = 'Valid until &lt;i&gt;soon&lt;/i&gt; &amp; &#39;later&#39;';
    expect(bodyOf(email.html)).toBe(`${EN_INTRO_PARAGRAPH}\n    ${optionalParagraph(total)}${optionalParagraph(expiry)}`);
    expect(email.text).toBe([EN_INTRO, total, expiry, '', EN_LINK, ''].join('\n'));
  });

  it('E-T4: escapes the link in both hrefs and where it is spelled out, and leaves it verbatim in the text', () => {
    const email = emailOf(E_T4.ampersandUrl);
    expect(hrefsOf(email.html)).toEqual(['https://app.metra.test/p/tok?a=1&amp;b=2', 'https://app.metra.test/p/tok?a=1&amp;b=2']);
    expect(email.html).toContain('">https://app.metra.test/p/tok?a=1&amp;b=2</a></p>');
    expect(email.text).toBe(
      [EN_INTRO, 'Total: EGP 124,000.00', 'Valid until 2026-09-30', '', 'View & respond to the quote: https://app.metra.test/p/tok?a=1&b=2', ''].join('\n'),
    );
  });

  it('E-T4: a double quote in the link cannot end either href', () => {
    const email = emailOf(E_T4.hostileUrl);
    const escaped = 'https://app.metra.test/p/tok&quot; onmouseover=&quot;steal()&quot; x=&quot;';
    expect(hrefsOf(email.html)).toEqual([escaped, escaped]);
    expect(email.html).not.toContain('onmouseover="');
    expect(email.text.split('\n')[4]).toBe('View & respond to the quote: https://app.metra.test/p/tok" onmouseover="steal()" x="');
  });
});

describe('proposalSentEmailTemplate, the language', () => {
  it('E-T5: is Arabic and right to left for a locale that starts with "ar", English and left to right for any other', () => {
    const AR_SUBJECT = 'عرض سعر Q-2026-0007 من Cairo Fit-out';
    const EN_SUBJECT = 'Quotation Q-2026-0007 from Cairo Fit-out';
    const expected: Array<[subject: string, opening: string]> = [
      [AR_SUBJECT, '<!doctype html><html dir="rtl">'], // ar-EG
      [EN_SUBJECT, '<!doctype html><html dir="ltr">'], // en
      [AR_SUBJECT, '<!doctype html><html dir="rtl">'], // ar
      [EN_SUBJECT, '<!doctype html><html dir="ltr">'], // fr
      [EN_SUBJECT, '<!doctype html><html dir="ltr">'], // AR-eg
      [EN_SUBJECT, '<!doctype html><html dir="ltr">'], // the empty string
    ];
    expect(E_T5).toHaveLength(expected.length);
    for (const [i, [subject, opening]] of expected.entries()) {
      const email = emailOf(E_T5[i]);
      expect([E_T5[i].id, email.subject]).toEqual([E_T5[i].id, subject]);
      expect([E_T5[i].id, email.html.slice(0, opening.length)]).toEqual([E_T5[i].id, opening]);
    }
  });
});

describe('proposalSentEmailTemplate, bad input', () => {
  it('E-T6: throws a TypeError for an input it cannot read', () => {
    expect(E_T6).toHaveLength(12);
    for (const run of E_T6) {
      expect([run.id, outputOf(run)]).toEqual([run.id, 'THROWN TypeError']);
    }
  });
});
