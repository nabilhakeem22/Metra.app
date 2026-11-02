import { describe, expect, it } from 'vitest';
import type { ActionCode } from '@/lib/actions/result';
import { homeRetryMayHelp, sharedLinkOf } from './shared-link';

// H6.4: an act's answer hands the studio the client home (an execution
// contract just issued), a document's own link (a proposal contract's /c, a
// change order's /v), or nothing.

describe('sharedLinkOf', () => {
  it('the client home first, else the document link, else nothing', () => {
    const home = { ok: true as const, clientHasEmail: true, link: 'https://studio.example/en/d/raw?tab=execution' };
    expect(sharedLinkOf({ ok: true, clientHome: home })).toEqual({ kind: 'home', answer: home });
    const refused = { ok: false as const, error: 'client_home_unavailable' as const };
    expect(sharedLinkOf({ ok: true, clientHome: refused })).toEqual({ kind: 'home', answer: refused });
    expect(sharedLinkOf({ ok: true, link: 'https://studio.example/en/c/raw' })).toEqual({ kind: 'document', link: 'https://studio.example/en/c/raw' });
    expect(sharedLinkOf({ ok: true })).toBeNull();
    expect(sharedLinkOf({ ok: true, link: '' })).toBeNull();
  });
});

describe('homeRetryMayHelp (functional F3)', () => {
  it.each<ActionCode>(['generic', 'uncertain', 'busy', 'engagement_state_conflict'])('a transient %s: yes', (error) => {
    expect(homeRetryMayHelp({ ok: false, error })).toBe(true);
  });

  it.each<ActionCode>(['client_home_unavailable', 'flow_not_enabled', 'contract_terminated', 'contract_not_issued', 'forbidden', 'record_not_found'])(
    'a refusal that answers the same every time, %s: no',
    (error) => {
      expect(homeRetryMayHelp({ ok: false, error })).toBe(false);
    },
  );

  it('an answer that holds a home: no', () => {
    expect(homeRetryMayHelp({ ok: true, clientHasEmail: true, link: 'https://studio.example/en/d/raw' })).toBe(false);
    expect(homeRetryMayHelp({ ok: true, clientHasEmail: true, link: null, linkReason: 'delivery_links_not_configured' })).toBe(false);
  });
});
