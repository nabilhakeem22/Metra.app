// CHARACTERIZATION of createProjectCore: what it answers and, statement by
// statement, what it asks the database on every branch. Written against the code
// as it stood BEFORE it was split into named phases, and not edited since: a
// refactor that changes a statement, its parameters, the order, an early return,
// a thrown code, a named-constraint refusal, a log line or the audit row fails
// here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; validate, loadWorkspaceEntitlements, withinLimit, allocateNumber,
// formatDocNumber, assertClientUsable and appendSystemActivity run for real. What
// a real Postgres adds (the advisory lock serialising two allocations, the code
// index refusing the loser of a race, RLS, the same-org foreign keys) is proven
// in tests/actions/projects.dbtest.ts and projectProfile.dbtest.ts.
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

const CLIENT = '44444444-4444-4444-8444-444444444444';
const TYPE = '66666666-6666-4666-8666-666666666666';

// The statements, exactly as the unsplit core issued them.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const READ_ENTITLEMENTS =
  'select({enabledFlows: workspace_entitlements.enabled_flows, limits: workspace_entitlements.limits, features: workspace_entitlements.features}).from(table:workspace_entitlements).where(sql("workspace_entitlements"."org_id" = $1 ["o-1"])).limit(1)';
const COUNT_PROJECTS = 'select({n: sql(count(*)::int [])}).from(table:projects)';
const LOCK_NUMBERING = 'execute(sql(select pg_advisory_xact_lock(hashtext($1)) ["o-1:project"]))';
const READ_NEXT_NUMBER = 'execute(sql(select coalesce(max("number"), 0) + 1 as next from public."projects" []))';
const READ_DUPLICATE_OF_ALLOCATED =
  'select({id: projects.id}).from(table:projects).where(sql("projects"."code" = $1 ["P-2026-0007"])).limit(1)';
const READ_DUPLICATE_OF_TYPED =
  'select({id: projects.id}).from(table:projects).where(sql("projects"."code" = $1 ["PRJ-9"])).limit(1)';
const READ_CLIENT =
  'select({id: clients.id, active: clients.active}).from(table:clients).where(sql("clients"."id" = $1 ["44444444-4444-4444-8444-444444444444"])).limit(1)';
const INSERT_WITH_ALLOCATED_CODE =
  'insert(table:projects).values({orgId: "o-1", code: "P-2026-0007", nameEn: "Tower", nameAr: null, clientId: "44444444-4444-4444-8444-444444444444", typeId: null, advancePct: "0", retentionPct: "0", startDate: "2026-11-01", endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", number: 7}).returning({id: projects.id})';
const INSERT_WITH_TYPED_CODE =
  'insert(table:projects).values({orgId: "o-1", code: "PRJ-9", nameEn: "Tower", nameAr: null, clientId: "44444444-4444-4444-8444-444444444444", typeId: null, advancePct: "0", retentionPct: "0", startDate: "2026-11-01", endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", number: null}).returning({id: projects.id})';
const READ_ACTIVE_TEMPLATES =
  'select().from(table:stage_templates).where(sql("stage_templates"."active" = $1 [true])).orderBy(sql("stage_templates"."sort_order" asc []), sql("stage_templates"."created_at" asc []))';
const INSERT_STAGES =
  'insert(table:project_stages).values([{orgId: "o-1", projectId: "p-9", stageKey: "design", nameEn: "Design", nameAr: "تصميم", sortOrder: 0, status: "not_started", progressPct: "0"}, {orgId: "o-1", projectId: "p-9", stageKey: "civil", nameEn: "Civil works", nameAr: null, sortOrder: 1, status: "not_started", progressPct: "0"}])';
const INSERT_ACTIVITY =
  'insert(table:activities).values({orgId: "o-1", entityType: "project", entityId: "p-9", actorUserId: "u-1", kind: "project_created", note: null, meta: null})';
const AUDIT_WITH_ALLOCATED_CODE =
  'audit {entity: "project", entityId: "p-9", action: "create", before: null, after: {code: null, client_id: "44444444-4444-4444-8444-444444444444", status: "active"}}';
const AUDIT_WITH_TYPED_CODE =
  'audit {entity: "project", entityId: "p-9", action: "create", before: null, after: {code: "PRJ-9", client_id: "44444444-4444-4444-8444-444444444444", status: "active"}}';

// The same, for another org and creator with every field typed.
const BEGIN_SECOND = 'begin [{orgId: "o-2", userId: "u-2", role: "project_manager"}, {write: true, capTransaction: undefined}]';
const READ_ENTITLEMENTS_SECOND =
  'select({enabledFlows: workspace_entitlements.enabled_flows, limits: workspace_entitlements.limits, features: workspace_entitlements.features}).from(table:workspace_entitlements).where(sql("workspace_entitlements"."org_id" = $1 ["o-2"])).limit(1)';
const LOCK_NUMBERING_SECOND = 'execute(sql(select pg_advisory_xact_lock(hashtext($1)) ["o-2:project"]))';
const READ_DUPLICATE_SECOND =
  'select({id: projects.id}).from(table:projects).where(sql("projects"."code" = $1 ["P-2026-0001"])).limit(1)';
const INSERT_EVERY_FIELD =
  'insert(table:projects).values({orgId: "o-2", code: "P-2026-0001", nameEn: "Tower", nameAr: "برج", clientId: "44444444-4444-4444-8444-444444444444", typeId: "66666666-6666-4666-8666-666666666666", advancePct: "10", retentionPct: "5", startDate: "2026-11-01", endDate: "2027-03-31", description: "Lobby and two floors", city: "Giza", country: "Egypt", address: "12 Nile St", notes: "Night shifts only", status: "on_hold", number: 1}).returning({id: projects.id})';
const INSERT_STAGES_SECOND =
  'insert(table:project_stages).values([{orgId: "o-2", projectId: "p-9", stageKey: "design", nameEn: "Design", nameAr: "تصميم", sortOrder: 0, status: "not_started", progressPct: "0"}, {orgId: "o-2", projectId: "p-9", stageKey: "civil", nameEn: "Civil works", nameAr: null, sortOrder: 1, status: "not_started", progressPct: "0"}])';
const INSERT_ACTIVITY_SECOND =
  'insert(table:activities).values({orgId: "o-2", entityType: "project", entityId: "p-9", actorUserId: "u-2", kind: "project_created", note: null, meta: null})';
const AUDIT_ON_HOLD =
  'audit {entity: "project", entityId: "p-9", action: "create", before: null, after: {code: null, client_id: "44444444-4444-4444-8444-444444444444", status: "on_hold"}}';

// The same, in another year.
const READ_DUPLICATE_NEXT_YEAR =
  'select({id: projects.id}).from(table:projects).where(sql("projects"."code" = $1 ["P-2027-0012"])).limit(1)';
const INSERT_NEXT_YEAR =
  'insert(table:projects).values({orgId: "o-1", code: "P-2027-0012", nameEn: "Tower", nameAr: null, clientId: "44444444-4444-4444-8444-444444444444", typeId: null, advancePct: "0", retentionPct: "0", startDate: "2026-11-01", endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", number: 12}).returning({id: projects.id})';

const SEAT_CHECK = [BEGIN, READ_ENTITLEMENTS, COUNT_PROJECTS];
const UP_TO_ALLOCATED_CODE = [...SEAT_CHECK, LOCK_NUMBERING, READ_NEXT_NUMBER, READ_DUPLICATE_OF_ALLOCATED];
const UP_TO_TYPED_CODE = [...SEAT_CHECK, READ_DUPLICATE_OF_TYPED];

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const viewer: OrgContext = { ...owner, role: 'viewer' };
const secondManager: OrgContext = { orgId: 'o-2', userId: 'u-2', role: 'project_manager' };

const base = { nameEn: 'Tower', clientId: CLIENT, startDate: '2026-11-01' };
const typedCode = { ...base, code: ' PRJ-9 ' };
const plan = (limits: Record<string, number>) => [{ enabledFlows: ['interior'], limits, features: {} }];
const count = (n: number) => [{ n }];
const lock = [{ pg_advisory_xact_lock: '' }];
const next = (n: number) => [{ next: n }];
const client = [{ id: CLIENT, active: true }];
const row = [{ id: 'p-9' }];
// Their own sortOrder is NOT 0 and 1: the stage rows take the index, not this.
const templates = [
  { id: 't-1', key: 'design', nameEn: 'Design', nameAr: 'تصميم', sortOrder: 10, active: true },
  { id: 't-2', key: 'civil', nameEn: 'Civil works', nameAr: null, sortOrder: 20, active: true },
];

/** A scripted result that makes its statement REJECT, the way the driver refuses a constraint. */
const refusedBy = (code: string, constraint: string) => ({
  then: (_resolve: unknown, reject: (reason: unknown) => void) => reject({ code, constraint_name: constraint }),
});

const PERCENT_OUT_OF_RANGE = { code: 'out_of_range', params: { min: 0, max: 100 } };

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

describe('createProjectCore, before a transaction opens', () => {
  it('J1 a status outside the list is malformed', async () => {
    expect(await createProjectCore(owner, { ...base, status: 'bogus' as never })).toEqual({
      ok: false,
      error: 'malformed',
    });
    expectTrace([], 0);
  });

  it('J2 a type id that is no id is malformed', async () => {
    expect(await createProjectCore(owner, { ...base, typeId: 'x' })).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('J3 no name in either language is refused under name', async () => {
    expect(await createProjectCore(owner, { clientId: CLIENT, startDate: '2026-11-01' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { name: { code: 'name_required' } },
    });
    expectTrace([], 0);
  });

  it('J4 a new project must carry a start date', async () => {
    expect(await createProjectCore(owner, { nameEn: 'Tower', clientId: CLIENT })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { startDate: { code: 'start_date_required' } },
    });
    expectTrace([], 0);
  });

  it('J5 the input is validated BEFORE the capability: a viewer with no name hears about the name', async () => {
    expect(await createProjectCore(viewer, { clientId: CLIENT, startDate: '2026-11-01' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { name: { code: 'name_required' } },
    });
    expectTrace([], 0);
  });

  it('J6 a viewer with a valid project is forbidden, opening nothing', async () => {
    expect(await createProjectCore(viewer, base)).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });
});

describe('createProjectCore, the plan seat', () => {
  it('J7 a workspace AT its limit is project_limit_reached, before a number is allocated', async () => {
    db.respond(plan({ projects: 2 }), count(2));
    expect(await createProjectCore(owner, base)).toEqual({ ok: false, error: 'project_limit_reached' });
    expectTrace([...SEAT_CHECK, 'end'], 0);
  });

  it('J8 one seat under the limit creates: an allocated code and number, stages by index, the activity, the audit with a null code', async () => {
    db.respond(plan({ projects: 2 }), count(1), lock, next(7), [], client, row, templates, [], []);
    expect(await createProjectCore(owner, base)).toEqual({ ok: true, data: 'p-9' });
    expectTrace(
      [
        ...UP_TO_ALLOCATED_CODE,
        READ_CLIENT,
        INSERT_WITH_ALLOCATED_CODE,
        READ_ACTIVE_TEMPLATES,
        INSERT_STAGES,
        INSERT_ACTIVITY,
        AUDIT_WITH_ALLOCATED_CODE,
        'end',
      ],
      0,
    );
  });

  it('J9 a workspace with no entitlements row logs one line and is not capped', async () => {
    db.respond([], count(500), lock, next(7), [], client, row, [], []);
    expect(await createProjectCore(owner, base)).toEqual({ ok: true, data: 'p-9' });
    expectTrace(
      [
        ...UP_TO_ALLOCATED_CODE,
        READ_CLIENT,
        INSERT_WITH_ALLOCATED_CODE,
        READ_ACTIVE_TEMPLATES,
        INSERT_ACTIVITY,
        AUDIT_WITH_ALLOCATED_CODE,
        'end',
      ],
      1,
    );
    expect(log).toHaveBeenCalledWith('entitlements_row_missing orgId=o-1');
  });

  it('J10 a plan with no project limit is unlimited; with no active template no stage is inserted', async () => {
    db.respond(plan({}), count(3), lock, next(7), [], client, row, [], []);
    expect(await createProjectCore(owner, base)).toEqual({ ok: true, data: 'p-9' });
    expectTrace(
      [
        ...UP_TO_ALLOCATED_CODE,
        READ_CLIENT,
        INSERT_WITH_ALLOCATED_CODE,
        READ_ACTIVE_TEMPLATES,
        INSERT_ACTIVITY,
        AUDIT_WITH_ALLOCATED_CODE,
        'end',
      ],
      0,
    );
  });
});

describe('createProjectCore, the code', () => {
  it('J11 a typed code is trimmed and kept: no lock, no number, and the audit carries it', async () => {
    db.respond(plan({}), count(3), [], client, row, [], []);
    expect(await createProjectCore(owner, typedCode)).toEqual({ ok: true, data: 'p-9' });
    expectTrace(
      [
        ...UP_TO_TYPED_CODE,
        READ_CLIENT,
        INSERT_WITH_TYPED_CODE,
        READ_ACTIVE_TEMPLATES,
        INSERT_ACTIVITY,
        AUDIT_WITH_TYPED_CODE,
        'end',
      ],
      0,
    );
  });

  it('J12 a typed code another project holds is code_taken, the client never read', async () => {
    db.respond(plan({}), count(3), [{ id: 'p-0' }]);
    expect(await createProjectCore(owner, typedCode)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { code: { code: 'code_taken' } },
    });
    expectTrace([...UP_TO_TYPED_CODE, 'end'], 0);
  });

  it('J13 an ALLOCATED code is checked the same way, after the lock and the number', async () => {
    db.respond(plan({}), count(3), lock, next(7), [{ id: 'p-0' }]);
    expect(await createProjectCore(owner, base)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { code: { code: 'code_taken' } },
    });
    expectTrace([...UP_TO_ALLOCATED_CODE, 'end'], 0);
  });

  it('J17 the allocated code takes the year of the clock, not a fixed one', async () => {
    vi.setSystemTime(new Date('2027-06-15T10:00:00.000Z'));
    try {
      db.respond(plan({}), count(3), lock, next(12), [], client, row, [], []);
      expect(await createProjectCore(owner, base)).toEqual({ ok: true, data: 'p-9' });
    } finally {
      vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
    }
    expectTrace(
      [
        ...SEAT_CHECK,
        LOCK_NUMBERING,
        READ_NEXT_NUMBER,
        READ_DUPLICATE_NEXT_YEAR,
        READ_CLIENT,
        INSERT_NEXT_YEAR,
        READ_ACTIVE_TEMPLATES,
        INSERT_ACTIVITY,
        AUDIT_WITH_ALLOCATED_CODE,
        'end',
      ],
      0,
    );
  });
});

describe('createProjectCore, the client', () => {
  it('J14 a client that no longer resolves is refused under clientId, and no project is written', async () => {
    db.respond(plan({}), count(3), [], []);
    expect(await createProjectCore(owner, typedCode)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { clientId: { code: 'no_longer_exists' } },
    });
    expectTrace([...UP_TO_TYPED_CODE, READ_CLIENT, 'end'], 0);
  });

  it('J15 an archived client is refused the same way', async () => {
    db.respond(plan({}), count(3), [], [{ id: CLIENT, active: false }]);
    expect(await createProjectCore(owner, typedCode)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { clientId: { code: 'no_longer_exists' } },
    });
    expectTrace([...UP_TO_TYPED_CODE, READ_CLIENT, 'end'], 0);
  });
});

describe('createProjectCore, another org and every field', () => {
  it('J16 the org, the creator and each typed field are carried into the statements and the audit', async () => {
    db.respond(plan({}), count(3), lock, next(1), [], client, row, templates, [], []);
    const everyField = {
      nameEn: 'Tower',
      nameAr: 'برج',
      clientId: CLIENT,
      typeId: TYPE,
      status: 'on_hold' as const,
      description: 'Lobby and two floors',
      advancePct: '10',
      retentionPct: '5',
      startDate: '2026-11-01',
      endDate: '2027-03-31',
      city: 'Giza',
      country: 'Egypt',
      address: '12 Nile St',
      notes: 'Night shifts only',
    };
    expect(await createProjectCore(secondManager, everyField)).toEqual({ ok: true, data: 'p-9' });
    expectTrace(
      [
        BEGIN_SECOND,
        READ_ENTITLEMENTS_SECOND,
        COUNT_PROJECTS,
        LOCK_NUMBERING_SECOND,
        READ_NEXT_NUMBER,
        READ_DUPLICATE_SECOND,
        READ_CLIENT,
        INSERT_EVERY_FIELD,
        READ_ACTIVE_TEMPLATES,
        INSERT_STAGES_SECOND,
        INSERT_ACTIVITY_SECOND,
        AUDIT_ON_HOLD,
        'end',
      ],
      0,
    );
  });
});

describe('createProjectCore, the races its insert can lose', () => {
  it.each([
    ['23505', 'projects_org_id_code_unique', { code: { code: 'code_taken' } }],
    ['23514', 'projects_advance_pct_range', { advancePct: PERCENT_OUT_OF_RANGE }],
    ['23514', 'projects_retention_pct_range', { retentionPct: PERCENT_OUT_OF_RANGE }],
    ['23503', 'projects_client_same_org_fk', { clientId: { code: 'no_longer_exists' } }],
    ['23503', 'projects_type_same_org_fk', { typeId: { code: 'no_longer_exists' } }],
  ])('J18 a %s on %s is answered under its field, silently', async (code, constraint, fields) => {
    db.respond(plan({}), count(3), [], client, refusedBy(code, constraint));
    expect(await createProjectCore(owner, typedCode)).toEqual({ ok: false, error: 'check_fields', fields });
    expectTrace([...UP_TO_TYPED_CODE, READ_CLIENT, INSERT_WITH_TYPED_CODE, 'end'], 0);
  });

  it('J19 a constraint the core did not name stays in the logged tail: generic, one line', async () => {
    db.respond(plan({}), count(3), [], client, refusedBy('23505', 'projects_some_other_unique'));
    expect(await createProjectCore(owner, typedCode)).toMatchObject({ ok: false, error: 'generic' });
    expectTrace([...UP_TO_TYPED_CODE, READ_CLIENT, INSERT_WITH_TYPED_CODE, 'end'], 1);
    expect(log.mock.calls[0]?.[0]).toBe('mutateInOrg failed');
  });
});
