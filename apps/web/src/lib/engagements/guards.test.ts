import type { DesignEngagement } from '@metra/db';
import { describe, expect, it } from 'vitest';
import { GUARDS, type GuardFacts } from './guards';

// A guard reads only titleAr/titleEn/clientId/projectId from the engagement, so
// a partial row cast to the full type is a faithful fixture for these predicates.
function engagement(over: Partial<DesignEngagement>): GuardFacts {
  return {
    engagement: {
      titleAr: 'عنوان',
      titleEn: 'Title',
      clientId: 'c1',
      projectId: 'p1',
      ...over,
    } as DesignEngagement,
  };
}

describe('scopeInputsPresent', () => {
  it('passes when a title (either language), a client, and a project are set', () => {
    expect(GUARDS.scopeInputsPresent(engagement({}))).toEqual({ ok: true });
    expect(
      GUARDS.scopeInputsPresent(engagement({ titleAr: null })),
    ).toEqual({ ok: true });
    expect(
      GUARDS.scopeInputsPresent(engagement({ titleEn: null })),
    ).toEqual({ ok: true });
  });

  it('fails when both titles are absent/blank', () => {
    expect(
      GUARDS.scopeInputsPresent(engagement({ titleAr: '  ', titleEn: null })),
    ).toEqual({ ok: false, code: 'guard_scope_inputs_missing' });
  });

  it('fails when the client or project is missing', () => {
    expect(
      GUARDS.scopeInputsPresent(engagement({ clientId: '' as string })),
    ).toEqual({ ok: false, code: 'guard_scope_inputs_missing' });
    expect(
      GUARDS.scopeInputsPresent(engagement({ projectId: '' as string })),
    ).toEqual({ ok: false, code: 'guard_scope_inputs_missing' });
  });
});

describe('pendingGuard', () => {
  it('always fails closed with transition_not_yet_enabled', () => {
    expect(GUARDS.pendingGuard(engagement({}))).toEqual({
      ok: false,
      code: 'transition_not_yet_enabled',
    });
    expect(
      GUARDS.pendingGuard(engagement({ titleAr: null, titleEn: null })),
    ).toEqual({ ok: false, code: 'transition_not_yet_enabled' });
  });
});
