import { describe, expect, it } from 'vitest';
import { summarizeTick, tickLogLine } from './run-summary';
import type { OrgAutomationResult, OrgRunOutcome } from './types';

function core(
  orgId: string,
  automation: OrgAutomationResult['automation'],
  overrides: Partial<OrgAutomationResult> = {},
): OrgAutomationResult {
  return {
    orgId,
    automation,
    failed: false,
    ran: true,
    effects: 0,
    emailsSent: 0,
    emailsFailed: 0,
    ...overrides,
  };
}

const outcomes: OrgRunOutcome[] = [
  {
    orgId: 'org-a',
    status: 'processed',
    results: [
      core('org-a', 'expire'),
      core('org-a', 'digest', { emailsSent: 2, emailsFailed: 1 }),
    ],
  },
  { orgId: 'org-b', status: 'skipped' },
  {
    orgId: 'org-c',
    status: 'processed',
    results: [
      core('org-c', 'followup', { failed: true, ran: false }),
      core('org-c', 'stage', { emailsSent: 1 }),
    ],
  },
  { orgId: 'org-d', status: 'failed' },
];

describe('summarizeTick', () => {
  it('counts orgs by outcome and sums cores and emails across them', () => {
    const summary = summarizeTick(outcomes, new Date('2026-10-05T21:00:00Z'), 1234);
    expect(summary).toMatchObject({
      ranAt: '2026-10-05T21:00:00.000Z',
      orgsTotal: 4,
      orgsProcessed: 2,
      orgsSkipped: 1,
      orgsFailed: 1,
      coreFailures: 1,
      emailsSent: 3,
      emailsFailed: 1,
      durationMs: 1234,
    });
  });

  it('keeps results in the order the orgs arrived in', () => {
    const summary = summarizeTick(outcomes, new Date(), 0);
    expect(summary.results.map((r) => `${r.orgId}:${r.automation}`)).toEqual([
      'org-a:expire',
      'org-a:digest',
      'org-c:followup',
      'org-c:stage',
    ]);
  });

  it('summarises an empty tick', () => {
    expect(summarizeTick([], new Date(), 5)).toMatchObject({
      orgsTotal: 0,
      orgsProcessed: 0,
      coreFailures: 0,
      emailsSent: 0,
      results: [],
    });
  });
});

describe('tickLogLine', () => {
  it('is one line of counts with no org id in it', () => {
    const line = tickLogLine(summarizeTick(outcomes, new Date(), 1234));
    expect(line).toBe(
      'automation tick: orgs=4 processed=2 skipped=1 failed=1 coreFailures=1' +
        ' emailsSent=3 emailsFailed=1 durationMs=1234',
    );
    expect(line).not.toMatch(/org-[a-d]/);
  });
});
