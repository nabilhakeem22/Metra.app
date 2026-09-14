import { describe, expect, it } from 'vitest';
import { esc, pickEscaped } from './html';

describe('esc', () => {
  it('escapes all five characters, including the single quote', () => {
    // The PDF copies escaped only four and left the apostrophe raw, so any
    // single-quoted attribute a template introduced would have been a hole.
    expect(esc(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('prints nothing for an absent field, not the word "null"', () => {
    // Every field on a document detail is nullable. This tolerance is the reason
    // the wrapper exists rather than calling escapeHtml directly.
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc('')).toBe('');
  });
});

describe('pickEscaped', () => {
  it('prefers the locale language and escapes the result', () => {
    expect(pickEscaped('مكتب', 'Hassan & Sons', 'ar-EG')).toBe('مكتب');
    expect(pickEscaped('مكتب', 'Hassan & Sons', 'en')).toBe('Hassan &amp; Sons');
  });

  it('falls back to the other language when the preferred one is absent or blank', () => {
    // An empty title on a client's document is worse than one in the other language.
    expect(pickEscaped(null, 'Hassan & Sons', 'ar-EG')).toBe('Hassan &amp; Sons');
    expect(pickEscaped('   ', 'Hassan & Sons', 'ar-EG')).toBe('Hassan &amp; Sons');
    expect(pickEscaped('مكتب', null, 'en')).toBe('مكتب');
  });

  it('is empty when neither language is present', () => {
    expect(pickEscaped(null, null, 'en')).toBe('');
    expect(pickEscaped('  ', '  ', 'ar-EG')).toBe('  ');
  });

  it('escapes exactly ONCE — the result must not be re-escaped', () => {
    // F6: both templates fed this result through esc() again in the footer, so
    // "Hassan & Sons" reached the page as "Hassan &amp; Sons".
    const once = pickEscaped(null, 'Hassan & Sons', 'en');
    expect(once).toBe('Hassan &amp; Sons');
    expect(esc(once)).toBe('Hassan &amp;amp; Sons'); // what the bug produced
  });
});
