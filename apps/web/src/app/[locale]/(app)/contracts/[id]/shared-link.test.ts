import { describe, expect, it } from 'vitest';
import { sharedLinkOf } from './shared-link';

// H6.4: an act's answer hands the studio the client home (an execution
// contract just issued), a document's own link (a proposal contract's /c, a
// change order's /v), or nothing.

describe('sharedLinkOf', () => {
  it('the client home first, else the document link, else nothing', () => {
    const home = { ok: true as const, link: 'https://studio.example/en/d/raw?tab=execution' };
    expect(sharedLinkOf({ ok: true, clientHome: home })).toEqual({ kind: 'home', answer: home });
    const refused = { ok: false as const, error: 'client_home_unavailable' as const };
    expect(sharedLinkOf({ ok: true, clientHome: refused })).toEqual({ kind: 'home', answer: refused });
    expect(sharedLinkOf({ ok: true, link: 'https://studio.example/en/c/raw' })).toEqual({ kind: 'document', link: 'https://studio.example/en/c/raw' });
    expect(sharedLinkOf({ ok: true })).toBeNull();
    expect(sharedLinkOf({ ok: true, link: '' })).toBeNull();
  });
});
