import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PublishedHistory } from '../check/context';
import { admixturesPage, exampleFile, glassPage, steelSectionsPage } from '../testing/examples';
import { checkFixture } from '../testing/run';
import { renderReview } from './html';

const history: PublishedHistory = {
  items: new Map(),
  effective: new Map([['raw.steel.medium_beams', new Map([['2026-06', { status: 'priced' as const, price: '50000', bulletinPeriod: '2026-06' }]])]]),
  bulletins: [],
};

function review(options: { corrections?: unknown; hostile?: boolean } = {}) {
  const steel = steelSectionsPage();
  if (options.hostile) steel.rows[0] = { ...steel.rows[0], labelAr: '<script>alert("x")</script> & كمر', notes: "it's <b>", confidence: 'inferred', rule: 'R6' };
  const file = exampleFile([steel, admixturesPage(), glassPage()], 'md', 65);
  const outcome = checkFixture(file, { corrections: options.corrections, history });
  return renderReview({ period: '2026-07', findings: outcome.findings, context: outcome.context, stagedSha256: 'a'.repeat(64), history, offline: true });
}

const sectionText = (html: string, id: string) => html.slice(html.indexOf(`<section id="${id}">`), html.indexOf('</section>', html.indexOf(`<section id="${id}">`)));

describe('review.html', () => {
  it('matches the golden file for the worked examples E3, E4 and E5', () => {
    // Compared with line endings normalised: a Windows checkout (core.autocrlf)
    // hands the golden file back with CRLF. Regenerate with UPDATE_GOLDEN=1.
    const golden = join(dirname(fileURLToPath(import.meta.url)), 'review.golden.html');
    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(golden, review());
    expect(review()).toBe(readFileSync(golden, 'utf8').replace(/\r\n/g, '\n'));
  });

  it('is one RTL document with no script and no external asset', () => {
    const html = review();
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).not.toMatch(/<script|<link|src=|https?:\/\//i);
  });

  it('escapes every text it was handed', () => {
    const html = review({ hostile: true });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; كمر');
    expect(html).toContain('it&#39;s &lt;b&gt;');
  });

  it('lists the B9 and F10 rows to confirm against the PDF, with what was read and chosen', () => {
    const confirm = sectionText(review(), 'confirm');
    expect(confirm).toContain('<span class="count">14</span>');
    expect(confirm).toContain('p6.r1');
    expect(confirm).toContain('30.455 30.455 30.455 27.687 26.12 26.12');
    expect(confirm).toContain('26.12 | 26.12 | 27.687 | 30.455 | 30.455 | 30.455 | -');
  });

  it('lists an applied correction (AC 19), and the diff against the published price', () => {
    const corrections = [{ rowId: 'p6.r1', month: 7, value: null, reason: 'PDF page 11: July is empty' }];
    const html = review({ corrections });
    expect(sectionText(html, 'corrections')).toContain('PDF page 11: July is empty');
    expect(sectionText(html, 'diff')).toContain('50000 (2026-06)');
    expect(sectionText(html, 'diff')).toContain('51000 (2026-07)');
    expect(sectionText(html, 'diff')).toContain('2.0%');
  });
});
