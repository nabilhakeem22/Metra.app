// MORE CHARACTERIZATION of createProjectCore, beside the file committed before the
// split (which is not edited): every value the core passes through, with a
// SECOND value. The first file creates every project for one client and has the
// insert answer one id, so a statement that hard-coded either passed it; here
// the client and the new row's id are both different. And the two writes that
// follow the stages, the activity and the audit row: each awaited, and each
// answered as the unsplit code answers when the database refuses it. And an
// insert that answers no row: the templates are still read before anything fails.
// And a status sent as an empty string, which is not the same as none sent.
// Same recording double and conventions, with one difference in the audit double
// (below). Every scenario is green on the unsplit code and on the split code
// alike.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createRecordingTx } from '@/test/recording-tx';

/** One later turn of the event loop, past every microtask already queued. */
const laterTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

vi.mock('server-only', () => ({}));
const db = createRecordingTx();
/** What the audit row's insert answers: null lets it through, a failure refuses it. */
const auditInsert: { refusal: object | null } = { refusal: null };
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
// Unlike the first file's, this audit double answers on a LATER turn and journals
// when it SETTLES, the way an insert does. A core that does not await it has
// answered by then: its 'end' is journalled before the audit row, and a refusal
// of the row is a rejection nobody handles.
vi.mock('@/lib/audit', () => ({
  recordAudit: async (_tx: unknown, entry: unknown) => {
    await laterTurn();
    if (auditInsert.refusal) {
      db.journal.push('audit refused ' + db.render(entry));
      throw auditInsert.refusal;
    }
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
const INSERT_ONE_STAGE =
  'insert(table:project_stages).values([{orgId: "o-1", projectId: "p-21", stageKey: "design", nameEn: "Design", nameAr: "تصميم", sortOrder: 0, status: "not_started", progressPct: "0"}])';
const INSERT_ACTIVITY =
  'insert(table:activities).values({orgId: "o-1", entityType: "project", entityId: "p-21", actorUserId: "u-1", kind: "project_created", note: null, meta: null})';
const AUDIT_CREATED =
  'audit {entity: "project", entityId: "p-21", action: "create", before: null, after: {code: "PRJ-9", client_id: "99999999-9999-4999-8999-999999999999", status: "active"}}';
const AUDIT_REFUSED =
  'audit refused {entity: "project", entityId: "p-21", action: "create", before: null, after: {code: "PRJ-9", client_id: "99999999-9999-4999-8999-999999999999", status: "active"}}';

const UP_TO_THE_INSERT = [BEGIN, READ_ENTITLEMENTS, COUNT_PROJECTS, READ_DUPLICATE_OF_TYPED, READ_CLIENT, INSERT_PROJECT];
const UP_TO_THE_ACTIVITY = [...UP_TO_THE_INSERT, READ_ACTIVE_TEMPLATES, INSERT_ACTIVITY];

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

/** A scripted result that makes its statement land two turns LATER, journalling `label` when it does. */
const landsLater = (label: string, result: unknown) => ({
  then: (resolve: (value: unknown) => void) => {
    void laterTurn()
      .then(laterTurn)
      .then(() => {
        db.journal.push(label);
        resolve(result);
      });
  },
});

/** A scripted result that makes its statement REJECT, the way the driver refuses it. */
const rejectedWith = (failure: object) => ({
  then: (_resolve: unknown, reject: (reason: unknown) => void) => reject(failure),
});

/** The logged tail's answer, whole: its reference is random. */
const GENERIC = { ok: false, error: 'generic', reference: expect.any(String) };

/** What the log line says of reading the id of a row that is not there. */
const NO_ROW_TO_READ = { name: 'TypeError', message: "Cannot read properties of undefined (reading 'id')" };

let log: ReturnType<typeof vi.spyOn>;
/** Every rejection that nothing handled while a scenario ran. */
const unhandled: unknown[] = [];
const noteUnhandled = (reason: unknown) => void unhandled.push(reason);

/** The core's answer, taken after whatever it left in flight has settled: a write it did not await lands, or is refused, in these turns. */
async function settled<Answer>(call: Promise<Answer>): Promise<Answer> {
  const answer = await call;
  for (let turn = 0; turn < 3; turn += 1) await laterTurn();
  return answer;
}

/** The journal, that every scripted result was consumed, how many lines were logged, and that no rejection escaped. */
function expectTrace(journal: string[], logged: number): void {
  expect(db.journal).toEqual(journal);
  expect(db.pending()).toBe(0);
  expect(log).toHaveBeenCalledTimes(logged);
  expect(unhandled).toEqual([]);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
  process.on('unhandledRejection', noteUnhandled);
});
beforeEach(() => {
  db.reset();
  auditInsert.refusal = null;
  unhandled.length = 0;
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => log.mockRestore());
afterAll(() => {
  process.off('unhandledRejection', noteUnhandled);
  vi.useRealTimers();
});

describe('createProjectCore, a second client and a second new row', () => {
  it('J20 the client that was sent is the one read, written and audited; the id the insert answered is the one the stages, the activity, the audit and the answer carry', async () => {
    db.respond(plan, count, [], client, row, templates, [], []);
    expect(await settled(createProjectCore(owner, project))).toEqual({ ok: true, data: 'p-21' });
    expectTrace([...UP_TO_THE_INSERT, READ_ACTIVE_TEMPLATES, INSERT_STAGES, INSERT_ACTIVITY, AUDIT_CREATED, 'end'], 0);
  });
});

describe('createProjectCore, the smallest template list that seeds anything', () => {
  it('J24 a studio with ONE active template seeds that one stage', async () => {
    db.respond(plan, count, [], client, row, [templates[0]], [], []);
    expect(await settled(createProjectCore(owner, project))).toEqual({ ok: true, data: 'p-21' });
    expectTrace(
      [...UP_TO_THE_INSERT, READ_ACTIVE_TEMPLATES, INSERT_ONE_STAGE, INSERT_ACTIVITY, AUDIT_CREATED, 'end'],
      0,
    );
  });
});

describe('createProjectCore, an insert that answers no row', () => {
  // No known database path answers no row to INSERT ... RETURNING; the double
  // can. What is pinned is WHERE the unsplit code then fails: it reads the row's
  // id only when it builds a stage row or the activity, so the templates are
  // read first either way, and nothing is written after the insert.
  it('J25 with templates to seed, they are read and the failure comes while the stage rows are built: generic, one line, no stage insert', async () => {
    db.respond(plan, count, [], client, [], templates);
    const answer = await settled(createProjectCore(owner, project));
    expect(answer).toEqual(GENERIC);
    expectTrace([...UP_TO_THE_INSERT, READ_ACTIVE_TEMPLATES, 'end'], 1);
    expect(log.mock.calls[0]).toEqual(['mutateInOrg failed', { reference: answer.reference, failure: NO_ROW_TO_READ }]);
  });

  it('J26 with no template, they are still read and the failure comes at the activity: generic, one line, no activity', async () => {
    db.respond(plan, count, [], client, [], []);
    const answer = await settled(createProjectCore(owner, project));
    expect(answer).toEqual(GENERIC);
    expectTrace([...UP_TO_THE_INSERT, READ_ACTIVE_TEMPLATES, 'end'], 1);
    expect(log.mock.calls[0]).toEqual(['mutateInOrg failed', { reference: answer.reference, failure: NO_ROW_TO_READ }]);
  });
});

describe('createProjectCore, the activity and the audit row are awaited', () => {
  it('J21 an activity that lands two turns late has still landed before the audit row is written, and the audit row before the transaction ends', async () => {
    db.respond(plan, count, [], client, row, [], landsLater('activity landed', []));
    expect(await settled(createProjectCore(owner, project))).toEqual({ ok: true, data: 'p-21' });
    expectTrace([...UP_TO_THE_ACTIVITY, 'activity landed', AUDIT_CREATED, 'end'], 0);
  });

  it('J22 an activity the database refuses is the answer: generic with one line, no audit row, and no rejection escapes', async () => {
    db.respond(plan, count, [], client, row, [], rejectedWith({ code: '42501' }));
    expect(await settled(createProjectCore(owner, project))).toEqual(GENERIC);
    expectTrace([...UP_TO_THE_ACTIVITY, 'end'], 1);
    expect(log.mock.calls[0]?.[0]).toBe('mutateInOrg failed');
  });

  it('J23 an audit row the database refuses is the answer: generic with one line, inside the transaction, and no rejection escapes', async () => {
    auditInsert.refusal = { code: '42501' };
    db.respond(plan, count, [], client, row, [], []);
    expect(await settled(createProjectCore(owner, project))).toEqual(GENERIC);
    expectTrace([...UP_TO_THE_ACTIVITY, AUDIT_REFUSED, 'end'], 1);
    expect(log.mock.calls[0]?.[0]).toBe('mutateInOrg failed');
  });
});

describe('createProjectCore, a status sent as an empty string', () => {
  it('J27 only a status that was NOT sent defaults to active: an empty one is checked as it is, and is malformed', async () => {
    expect(await settled(createProjectCore(owner, { ...project, status: '' as never }))).toEqual({
      ok: false,
      error: 'malformed',
    });
    expectTrace([], 0);
  });
});
