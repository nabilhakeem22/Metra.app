import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape';

// The ONE escaper, now shared by the email templates AND the PDF templates. The
// PDF copies escaped four characters and left the apostrophe raw; these cases are
// the union, so a future edit cannot quietly go back to the weaker rule.

describe('escapeHtml', () => {
  it('escapes the five characters that matter in markup and attributes', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('escapes the single quote as the numeric entity', () => {
    // &apos; is not in the HTML4 entity set some mail clients parse, and the
    // numeric form makes the same function safe inside a single-quoted attribute.
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml("title='y'")).toBe('title=&#39;y&#39;');
  });

  it('escapes the ampersand FIRST, so entities are not double-encoded wrongly', () => {
    expect(escapeHtml('a&lt;b')).toBe('a&amp;lt;b');
  });

  it('leaves an already-safe string alone', () => {
    expect(escapeHtml('Hassan and Sons')).toBe('Hassan and Sons');
    expect(escapeHtml('مكتب ميترا')).toBe('مكتب ميترا');
    expect(escapeHtml('')).toBe('');
  });
});
