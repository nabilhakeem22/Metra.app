// CHARACTERIZATION of updateProjectCore: what it answers and, statement by
// statement, what it asks the database on every branch. Written against the code
// as it stood BEFORE its write was moved into a named phase, and not edited
// since: a refactor that changes a statement, its parameters, the order, an
// early return, a thrown code, a named-constraint refusal or the audit row fails
// here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; validate, requireInOrg and assertClientUsable run for real. What a
// real Postgres adds (RLS, the code index, the same-org foreign keys, the
// percentage CHECKs) is proven in tests/actions/projects.dbtest.ts. A project id
// that is no id is deliberately not a scenario: the double answers what a
// database would not.
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

const { updateProjectCore } = await import('./update');

const PROJECT = '55555555-5555-4555-8555-555555555555';
const CLIENT = '44444444-4444-4444-8444-444444444444';
const OLD_CLIENT = '33333333-3333-4333-8333-333333333333';
const TYPE = '66666666-6666-4666-8666-666666666666';

// The statements, exactly as the unsplit core issued them.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const BEGIN_SECOND = 'begin [{orgId: "o-2", userId: "u-2", role: "project_manager"}, {write: true, capTransaction: undefined}]';
const READ_PROJECT =
  'select({id: projects.id, clientId: projects.client_id}).from(table:projects).where(sql("projects"."id" = $1 ["55555555-5555-4555-8555-555555555555"])).limit(1)';
const READ_OTHER_HOLDER_OF_CODE =
  'select({id: projects.id}).from(table:projects).where(sql(("projects"."code" = $1 and "projects"."id" <> $2) ["PRJ-9","55555555-5555-4555-8555-555555555555"])).limit(1)';
const READ_OTHER_HOLDER_OF_TRIMMED_CODE =
  'select({id: projects.id}).from(table:projects).where(sql(("projects"."code" = $1 and "projects"."id" <> $2) ["P-2026-0003","55555555-5555-4555-8555-555555555555"])).limit(1)';
const READ_CLIENT =
  'select({id: clients.id, active: clients.active}).from(table:clients).where(sql("clients"."id" = $1 ["44444444-4444-4444-8444-444444444444"])).limit(1)';
const UPDATE_KEEPING_BOTH_PERCENTAGES =
  'update(table:projects).set({code: "PRJ-9", nameEn: "Tower", nameAr: null, clientId: "44444444-4444-4444-8444-444444444444", typeId: null, startDate: null, endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql("projects"."id" = $1 ["55555555-5555-4555-8555-555555555555"]))';
const UPDATE_WITH_ADVANCE_ONLY =
  'update(table:projects).set({code: "PRJ-9", nameEn: "Tower", nameAr: null, clientId: "44444444-4444-4444-8444-444444444444", typeId: null, startDate: null, endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", advancePct: "20", updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql("projects"."id" = $1 ["55555555-5555-4555-8555-555555555555"]))';
const UPDATE_WITH_NULL_ADVANCE_AS_ZERO =
  'update(table:projects).set({code: "PRJ-9", nameEn: "Tower", nameAr: null, clientId: "44444444-4444-4444-8444-444444444444", typeId: null, startDate: null, endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", advancePct: "0", retentionPct: "5", updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql("projects"."id" = $1 ["55555555-5555-4555-8555-555555555555"]))';
const UPDATE_WITH_RETENTION_ONLY =
  'update(table:projects).set({code: "PRJ-9", nameEn: "Tower", nameAr: null, clientId: "44444444-4444-4444-8444-444444444444", typeId: null, startDate: null, endDate: null, description: null, city: null, country: null, address: null, notes: null, status: "active", retentionPct: "7.5", updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql("projects"."id" = $1 ["55555555-5555-4555-8555-555555555555"]))';
const UPDATE_EVERY_FIELD =
  'update(table:projects).set({code: "P-2026-0003", nameEn: "Tower", nameAr: "برج", clientId: "44444444-4444-4444-8444-444444444444", typeId: "66666666-6666-4666-8666-666666666666", startDate: "2026-11-01", endDate: "2027-03-31", description: "Lobby and two floors", city: "Giza", country: "Egypt", address: "12 Nile St", notes: "Night shifts only", status: "completed", advancePct: "10", retentionPct: "5", updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql("projects"."id" = $1 ["55555555-5555-4555-8555-555555555555"]))';
const AUDIT_UPDATED =
  'audit {entity: "project", entityId: "55555555-5555-4555-8555-555555555555", action: "update", before: null, after: {code: "PRJ-9", client_id: "44444444-4444-4444-8444-444444444444", status: "active"}}';
const AUDIT_COMPLETED =
  'audit {entity: "project", entityId: "55555555-5555-4555-8555-555555555555", action: "update", before: null, after: {code: "P-2026-0003", client_id: "44444444-4444-4444-8444-444444444444", status: "completed"}}';

const UP_TO_THE_CODE_CHECK = [BEGIN, READ_PROJECT, READ_OTHER_HOLDER_OF_CODE];

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const viewer: OrgContext = { ...owner, role: 'viewer' };
const secondManager: OrgContext = { orgId: 'o-2', userId: 'u-2', role: 'project_manager' };

const base = { id: PROJECT, code: 'PRJ-9', nameEn: 'Tower', clientId: CLIENT, status: 'active' as const };
/** The project as stored, still with the client the edit names. */
const same = [{ id: PROJECT, clientId: CLIENT }];
/** The project as stored, with ANOTHER client: the edit reassigns it. */
const moved = [{ id: PROJECT, clientId: OLD_CLIENT }];
const updated = { ok: true, data: undefined };

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

describe('updateProjectCore, before a transaction opens', () => {
  it('U1 an edit with no status is malformed', async () => {
    const withoutStatus = { id: PROJECT, code: 'PRJ-9', nameEn: 'Tower', clientId: CLIENT };
    expect(await updateProjectCore(owner, withoutStatus)).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('U2 a blank code is refused under code', async () => {
    expect(await updateProjectCore(owner, { ...base, code: '  ' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { code: { code: 'code_required' } },
    });
    expectTrace([], 0);
  });

  it('U3 the input is validated BEFORE the capability: a viewer with no code hears about the code', async () => {
    expect(await updateProjectCore(viewer, { ...base, code: '' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { code: { code: 'code_required' } },
    });
    expectTrace([], 0);
  });

  it('U4 a viewer with a valid edit is forbidden, opening nothing', async () => {
    expect(await updateProjectCore(viewer, base)).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });
});

describe('updateProjectCore, the reads and their refusals', () => {
  it('U5 a project that does not resolve is record_not_found', async () => {
    db.respond([]);
    expect(await updateProjectCore(owner, base)).toEqual({ ok: false, error: 'record_not_found' });
    expectTrace([BEGIN, READ_PROJECT, 'end'], 0);
  });

  it('U6 a code ANOTHER project holds is code_taken; the read excludes the project itself', async () => {
    db.respond(same, [{ id: 'p-other' }]);
    expect(await updateProjectCore(owner, base)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { code: { code: 'code_taken' } },
    });
    expectTrace([...UP_TO_THE_CODE_CHECK, 'end'], 0);
  });

  it('U7 on a reassignment the code is still checked FIRST: code_taken, the client never read', async () => {
    db.respond(moved, [{ id: 'p-other' }]);
    expect(await updateProjectCore(owner, base)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { code: { code: 'code_taken' } },
    });
    expectTrace([...UP_TO_THE_CODE_CHECK, 'end'], 0);
  });

  it('U10 a reassignment to a client that no longer resolves is refused under clientId, nothing written', async () => {
    db.respond(moved, [], []);
    expect(await updateProjectCore(owner, base)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { clientId: { code: 'no_longer_exists' } },
    });
    expectTrace([...UP_TO_THE_CODE_CHECK, READ_CLIENT, 'end'], 0);
  });

  it('U11 a reassignment to an archived client is refused the same way', async () => {
    db.respond(moved, [], [{ id: CLIENT, active: false }]);
    expect(await updateProjectCore(owner, base)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { clientId: { code: 'no_longer_exists' } },
    });
    expectTrace([...UP_TO_THE_CODE_CHECK, READ_CLIENT, 'end'], 0);
  });
});

describe('updateProjectCore, the write and its audit', () => {
  it('U8 with the same client the client is NOT read; neither percentage is in the set; updatedAt is now', async () => {
    db.respond(same, [], []);
    expect(await updateProjectCore(owner, base)).toEqual(updated);
    expectTrace([...UP_TO_THE_CODE_CHECK, UPDATE_KEEPING_BOTH_PERCENTAGES, AUDIT_UPDATED, 'end'], 0);
  });

  it('U9 a reassignment reads the new client between the code check and the write; the audit carries the NEW client', async () => {
    db.respond(moved, [], [{ id: CLIENT, active: true }], []);
    expect(await updateProjectCore(owner, base)).toEqual(updated);
    expectTrace([...UP_TO_THE_CODE_CHECK, READ_CLIENT, UPDATE_KEEPING_BOTH_PERCENTAGES, AUDIT_UPDATED, 'end'], 0);
  });

  it('U12 an advance that was sent is written; the retention that was not is left out', async () => {
    db.respond(same, [], []);
    expect(await updateProjectCore(owner, { ...base, advancePct: '20' })).toEqual(updated);
    expectTrace([...UP_TO_THE_CODE_CHECK, UPDATE_WITH_ADVANCE_ONLY, AUDIT_UPDATED, 'end'], 0);
  });

  it('U13 an advance SENT as null is written as zero, beside the retention that was sent', async () => {
    db.respond(same, [], []);
    expect(await updateProjectCore(owner, { ...base, advancePct: null, retentionPct: '5' })).toEqual(updated);
    expectTrace([...UP_TO_THE_CODE_CHECK, UPDATE_WITH_NULL_ADVANCE_AS_ZERO, AUDIT_UPDATED, 'end'], 0);
  });

  it('U14 a retention that was sent is written; the advance that was not is left out', async () => {
    db.respond(same, [], []);
    expect(await updateProjectCore(owner, { ...base, retentionPct: '7.5' })).toEqual(updated);
    expectTrace([...UP_TO_THE_CODE_CHECK, UPDATE_WITH_RETENTION_ONLY, AUDIT_UPDATED, 'end'], 0);
  });

  it('U15 every field, a padded code and another org: the trimmed code and each column reach the statements', async () => {
    db.respond(same, [], []);
    const everyField = {
      id: PROJECT,
      code: ' P-2026-0003 ',
      nameEn: 'Tower',
      nameAr: 'برج',
      clientId: CLIENT,
      typeId: TYPE,
      status: 'completed' as const,
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
    expect(await updateProjectCore(secondManager, everyField)).toEqual(updated);
    expectTrace(
      [BEGIN_SECOND, READ_PROJECT, READ_OTHER_HOLDER_OF_TRIMMED_CODE, UPDATE_EVERY_FIELD, AUDIT_COMPLETED, 'end'],
      0,
    );
  });
});

describe('updateProjectCore, the races its write can lose', () => {
  it.each([
    ['23505', 'projects_org_id_code_unique', { code: { code: 'code_taken' } }],
    ['23514', 'projects_advance_pct_range', { advancePct: PERCENT_OUT_OF_RANGE }],
    ['23514', 'projects_retention_pct_range', { retentionPct: PERCENT_OUT_OF_RANGE }],
    ['23503', 'projects_client_same_org_fk', { clientId: { code: 'no_longer_exists' } }],
    ['23503', 'projects_type_same_org_fk', { typeId: { code: 'no_longer_exists' } }],
  ])('U16 a %s on %s is answered under its field, silently', async (code, constraint, fields) => {
    db.respond(same, [], refusedBy(code, constraint));
    expect(await updateProjectCore(owner, base)).toEqual({ ok: false, error: 'check_fields', fields });
    expectTrace([...UP_TO_THE_CODE_CHECK, UPDATE_KEEPING_BOTH_PERCENTAGES, 'end'], 0);
  });

  it('U17 a constraint the core did not name stays in the logged tail: generic, one line', async () => {
    db.respond(same, [], refusedBy('23505', 'projects_some_other_unique'));
    expect(await updateProjectCore(owner, base)).toMatchObject({ ok: false, error: 'generic' });
    expectTrace([...UP_TO_THE_CODE_CHECK, UPDATE_KEEPING_BOTH_PERCENTAGES, 'end'], 1);
    expect(log.mock.calls[0]?.[0]).toBe('mutateInOrg failed');
  });
});
