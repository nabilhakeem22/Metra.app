// The tick's orchestration: which orgs, in what order, how many at once, and
// what one failure is allowed to take down with it (nothing but itself). The
// cores, the system-actor read and the DB are stubbed; their own behaviour is
// pinned in tests/actions/automation.dbtest.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { automationSettings, organizations, type AutomationSettings } from '@metra/db';
import { asc } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import type { AutomationDeps, AutomationKey, AutomationResult } from './types';

vi.mock('server-only', () => ({}));

type CoreBehaviour = (key: AutomationKey, deps: AutomationDeps) => Promise<AutomationResult>;
const state = vi.hoisted(() => ({
  orgIds: [] as string[],
  settingsOrgIds: [] as string[],
  orderedBy: [] as unknown[],
  core: null as unknown as CoreBehaviour,
  resolveActor: null as unknown as (orgId: string) => Promise<OrgContext | null>,
}));

vi.mock('@/lib/db/client', () => ({
  withRequestDb: (run: (db: unknown) => Promise<unknown>) =>
    run({
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) {
            return {
              orderBy: async (...columns: unknown[]) => {
                state.orderedBy.push(...columns);
                return state.orgIds.map((id) => ({ id, defaultLocale: 'en' }));
              },
            };
          }
          if (table === automationSettings) {
            return Promise.resolve(state.settingsOrgIds.map((orgId) => ({ orgId })));
          }
          throw new Error('runner read an unexpected table');
        },
      }),
    }),
}));
vi.mock('./system-context', () => ({
  resolveSystemContext: (orgId: string) => state.resolveActor(orgId),
}));
vi.mock('./expire-proposals', () => ({
  runExpireProposals: (deps: AutomationDeps) => state.core('expire', deps),
}));
vi.mock('./followup-reminders', () => ({
  runFollowupReminders: (deps: AutomationDeps) => state.core('followup', deps),
}));
vi.mock('./portfolio-digest', () => ({
  runPortfolioDigest: (deps: AutomationDeps) => state.core('digest', deps),
}));
vi.mock('./stage-reminders', () => ({
  runStageReminders: (deps: AutomationDeps) => state.core('stage', deps),
}));
vi.mock('./recipients', () => ({
  createRecipientEmailLookup: () => vi.fn(async () => ({ status: 'no-address' })),
}));

import { ORG_CONCURRENCY, runDueAutomations } from './runner';

const NOW = new Date('2026-10-05T21:00:00Z');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function actorFor(orgId: string): OrgContext {
  return { orgId, userId: `owner-of-${orgId}`, role: 'owner' };
}

function emptyResult(key: AutomationKey): AutomationResult {
  return { automation: key, ran: true, effects: 0, emailsSent: 0, emailsFailed: 0 };
}

function useOrgs(orgIds: string[], settingsOrgIds: string[] = orgIds) {
  state.orgIds = orgIds;
  state.settingsOrgIds = settingsOrgIds;
}

beforeEach(() => {
  state.orderedBy = [];
  state.core = async (key) => emptyResult(key);
  state.resolveActor = async (orgId) => actorFor(orgId);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runDueAutomations', () => {
  it('reads orgs in id order and reports them in that order, whatever finishes first', async () => {
    useOrgs(['org-a', 'org-b', 'org-c']);
    // org-a is the slowest, so completion order is b, c, a.
    state.core = async (key, deps) => {
      await sleep(deps.ctx.orgId === 'org-a' ? 15 : 1);
      return emptyResult(key);
    };
    const summary = await runDueAutomations(NOW);

    expect(state.orderedBy).toEqual([asc(organizations.id)]);
    expect(summary.results.map((r) => `${r.orgId}:${r.automation}`)).toEqual(
      ['org-a', 'org-b', 'org-c'].flatMap((org) =>
        ['expire', 'followup', 'digest', 'stage'].map((key) => `${org}:${key}`),
      ),
    );
  });

  it(`works on at most ${ORG_CONCURRENCY} orgs at once, and one core at a time within an org`, async () => {
    useOrgs(['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']);
    const activeOrgs = new Set<string>();
    const activeCoresByOrg = new Map<string, number>();
    let peakOrgs = 0;
    let peakCoresInOneOrg = 0;
    state.resolveActor = async (orgId) => {
      activeOrgs.add(orgId);
      peakOrgs = Math.max(peakOrgs, activeOrgs.size);
      return actorFor(orgId);
    };
    state.core = async (key, deps) => {
      const orgId = deps.ctx.orgId;
      const running = (activeCoresByOrg.get(orgId) ?? 0) + 1;
      activeCoresByOrg.set(orgId, running);
      peakCoresInOneOrg = Math.max(peakCoresInOneOrg, running);
      await sleep(2);
      activeCoresByOrg.set(orgId, running - 1);
      if (key === 'stage') activeOrgs.delete(orgId);
      return emptyResult(key);
    };

    const summary = await runDueAutomations(NOW);
    expect(ORG_CONCURRENCY).toBe(3);
    expect(peakOrgs).toBe(ORG_CONCURRENCY);
    expect(peakCoresInOneOrg).toBe(1);
    expect(summary.orgsProcessed).toBe(7);
  });

  it('isolates a failing core and a failing org from everything else', async () => {
    useOrgs(['org-a', 'org-b', 'org-c', 'org-d']);
    state.resolveActor = async (orgId) => {
      if (orgId === 'org-c') throw new Error('memberships read timed out');
      return actorFor(orgId);
    };
    state.core = async (key, deps) => {
      if (deps.ctx.orgId === 'org-b' && key === 'followup') throw new Error('boom');
      return emptyResult(key);
    };
    const summary = await runDueAutomations(NOW);

    expect(summary).toMatchObject({
      orgsTotal: 4,
      orgsProcessed: 3,
      orgsFailed: 1,
      coreFailures: 1,
    });
    const orgB = summary.results.filter((r) => r.orgId === 'org-b');
    expect(orgB.map((r) => [r.automation, r.failed, r.ran])).toEqual([
      ['expire', false, true],
      ['followup', true, false],
      ['digest', false, true],
      ['stage', false, true],
    ]);
    expect(summary.results.some((r) => r.orgId === 'org-c')).toBe(false);
    expect(summary.results.filter((r) => r.orgId === 'org-d')).toHaveLength(4);
  });

  it('skips an org with no settings row or no owner/admin, without running a core', async () => {
    useOrgs(['org-a', 'no-settings', 'no-actor'], ['org-a', 'no-actor']);
    const askedForActor: string[] = [];
    state.resolveActor = async (orgId) => {
      askedForActor.push(orgId);
      return orgId === 'no-actor' ? null : actorFor(orgId);
    };
    const summary = await runDueAutomations(NOW);

    expect(summary).toMatchObject({ orgsTotal: 3, orgsProcessed: 1, orgsSkipped: 2 });
    expect(askedForActor).toEqual(['org-a', 'no-actor']);
    expect(new Set(summary.results.map((r) => r.orgId))).toEqual(new Set(['org-a']));
  });

  it('sums emails, logs one count-only line, and returns the same summary', async () => {
    useOrgs(['org-a', 'org-b']);
    state.core = async (key) => ({
      ...emptyResult(key),
      emailsSent: key === 'digest' ? 2 : 0,
      emailsFailed: key === 'stage' ? 1 : 0,
    });
    const summary = await runDueAutomations(NOW);

    expect(summary).toMatchObject({
      ranAt: NOW.toISOString(),
      emailsSent: 4,
      emailsFailed: 2,
      coreFailures: 0,
    });
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(console.info).toHaveBeenCalledTimes(1);
    const [line] = vi.mocked(console.info).mock.calls[0] ?? [];
    expect(line).toMatch(
      /^automation tick: orgs=2 processed=2 skipped=0 failed=0 coreFailures=0 emailsSent=4 emailsFailed=2 durationMs=\d+$/,
    );
  });

  it('hands every core on a tick the same recipient lookup, and the next tick a fresh one', async () => {
    useOrgs(['org-a', 'org-b']);
    const lookupsSeen: Array<AutomationDeps['lookupRecipientEmail']> = [];
    state.core = async (key, deps) => {
      lookupsSeen.push(deps.lookupRecipientEmail);
      return emptyResult(key);
    };
    await runDueAutomations(NOW);
    expect(new Set(lookupsSeen).size).toBe(1);

    await runDueAutomations(NOW);
    expect(new Set(lookupsSeen).size).toBe(2);
  });

  it('settings rows are matched to their own org', async () => {
    useOrgs(['org-a', 'org-b']);
    const settingsSeen: Array<[string, AutomationSettings]> = [];
    state.core = async (key, deps) => {
      settingsSeen.push([deps.ctx.orgId, deps.settings]);
      return emptyResult(key);
    };
    await runDueAutomations(NOW);
    for (const [orgId, settings] of settingsSeen) expect(settings.orgId).toBe(orgId);
  });
});
