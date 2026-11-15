// MORE CHARACTERIZATION of createProjectCore, beside the file committed before the
// split (which is not edited): every value the core passes through, with a
// SECOND value. The first file creates every project for one client and has the
// insert answer one id, so a statement that hard-coded either passed it; here
// the client and the new row's id are both different.
// Same recording double and conventions. Every scenario is green on the unsplit
// code and on the split code alike.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createRecordingTx } from '@/test/recording-tx';

vi.mock('server-only', () => ({}));
const db = createRecordingTx();
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async (ctx: unknown, fn: (tx: unknown) => unknown, options: unknown) => {
    db.journal.push('begin ' + db.render([ctx, options]));
    try {
      return await fn(db.tx);
    } finally {
      db.journal.push('end');
    }
  },
}));
vi.mock('@/lib/audit', () => ({
  recordAudit: async (_tx: unknown, entry: unknown) => {
    db.journal.push('audit ' + db.render(entry));
  },
}));

const { createProjectCore } = await import('./create');

// Not the client the first file uses.
const SECOND_CLIENT = '99999999-9999-4999-8999-999999999999';

// The statements, exactly as the unsplit core issues them for the second client
// and a new row that answers the id p-21.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const READ_ENTITLEMENTS =
  'select({enabledFlows: workspace_entitlements.enabled_flows, limits: workspace_entitlements.limits, features: workspace_entitlements.features}).from(table:workspace_entitlements).where(sql("workspace_entitlements"."org_id" = $1 ["o-1"])).limit(1)';
const COUNT_PROJECTS = 'select({n: sql(count(*)::int [])}).from(table:projects)';
const READ_DUPLICATE_OF_TYPED =
  'select({id: projects.id}).from(table:projects).where(sql("projects"."code" = $1 ["PRJ-9"])).limit(1)';
const READ_CLIENT =
  'select({id: clients.id, active: clients.active}).from(table:clients).where(sql("clients"."id" = $1 ["99999999-9999-4999-8999-999999999999"])).limit(1)';
const INSERT_PROJECT =
  'insert(table:projects).values({orgId: "o-1", code: "PRJ-9", nameEn: "Tower", nameAr: null, clientId: "99999999-9999-4999-8999-999999999999", typeId: null, advancePct: "0", retentionPct: "0", startDate: "2026-11-01", endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", number: null}).returning({id: projects.id})';
const READ_ACTIVE_TEMPLATES =
  'select().from(table:stage_templates).where(sql("stage_templates"."active" = $1 [true])).orderBy(sql("stage_templates"."sort_order" asc []), sql("stage_templates"."created_at" asc []))';
const INSERT_STAGES =
  'insert(table:project_stages).values([{orgId: "o-1", projectId: "p-21", stageKey: "design", nameEn: "Design", nameAr: "تصميم", sortOrder: 0, status: "not_started", progressPct: "0"}, {orgId: "o-1", projectId: "p-21", stageKey: "civil", nameEn: "Civil works", nameAr: null, sortOrder: 1, status: "not_started", progressPct: "0"}])';
const INSERT_ACTIVITY =
  'insert(table:activities).values({orgId: "o-1", entityType: "project", entityId: "p-21", actorUserId: "u-1", kind: "project_created", note: null, meta: null})';
const AUDIT_CREATED =
  'audit {entity: "project", entityId: "p-21", action: "create", before: null, after: {code: "PRJ-9", client_id: "99999999-9999-4999-8999-999999999999", status: "active"}}';

const UP_TO_THE_INSERT = [BEGIN, READ_ENTITLEMENTS, COUNT_PROJECTS, READ_DUPLICATE_OF_TYPED, READ_CLIENT, INSERT_PROJECT];

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };

const project = { nameEn: 'Tower', clientId: SECOND_CLIENT, startDate: '2026-11-01', code: 'PRJ-9' };
const plan = [{ enabledFlows: ['interior'], limits: {}, features: {} }];
const count = [{ n: 3 }];
const client = [{ id: SECOND_CLIENT, active: true }];
const row = [{ id: 'p-21' }];
const templates = [
  { id: 't-1', key: 'design', nameEn: 'Design', nameAr: 'تصميم', sortOrder: 10, active: true },
  { id: 't-2', key: 'civil', nameEn: 'Civil works', nameAr: null, sortOrder: 20, active: true },
];

let log: ReturnType<typeof vi.spyOn>;

/** The journal, that every scripted result was consumed, and how many lines were logged. */
function expectTrace(journal: string[], logged: number): void {
  expect(db.journal).toEqual(journal);
  expect(db.pending()).toBe(0);
  expect(log).toHaveBeenCalledTimes(logged);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
});
beforeEach(() => {
  db.reset();
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => log.mockRestore());
afterAll(() => vi.useRealTimers());

describe('createProjectCore, a second client and a second new row', () => {
  it('J20 the client that was sent is the one read, written and audited; the id the insert answered is the one the stages, the activity, the audit and the answer carry', async () => {
    db.respond(plan, count, [], client, row, templates, [], []);
    expect(await createProjectCore(owner, project)).toEqual({ ok: true, data: 'p-21' });
    expectTrace([...UP_TO_THE_INSERT, READ_ACTIVE_TEMPLATES, INSERT_STAGES, INSERT_ACTIVITY, AUDIT_CREATED, 'end'], 0);
  });
});
