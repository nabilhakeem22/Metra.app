// CHARACTERIZATION of createEngagementCore: what it answers and, statement by
// statement, what it asks the database on every branch. Written against the code
// as it stood BEFORE it was split into named phases, and not edited since: a
// refactor that changes a statement, its parameters, the order, an early return,
// a thrown code, a named-constraint refusal or the audit row fails here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; create-choices, allocate-number and delivery-slot run for real.
// What a real Postgres adds (the advisory lock serialising two creates, RLS, the
// one-active-per-project index) is proven in tests/actions/engagements.dbtest.ts
// and design-first-slot.dbtest.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createRecordingTx } from '@/test/recording-tx';

vi.mock('server-only', () => ({}));
const db = createRecordingTx();
const entitlement = { enabled: true };
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
    db.journal.push('begin');
    try {
      return await fn(db.tx);
    } finally {
      db.journal.push('end');
    }
  },
}));
vi.mock('@/lib/entitlements/entitlements', () => ({
  loadWorkspaceEntitlements: async () => ({}),
  canUseFlow: () => entitlement.enabled,
}));
vi.mock('@/lib/audit', () => ({
  recordAudit: async (_tx: unknown, entry: unknown) => {
    db.journal.push('audit ' + db.render(entry));
  },
}));

const { createEngagementCore } = await import('./core');

const CLIENT_ID = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';

// The statements, exactly as the unsplit core issued them.
const READ_CLIENT =
  'select({id: clients.id}).from(table:clients).where(sql("clients"."id" = $1 ["44444444-4444-4444-8444-444444444444"])).limit(1)';
const READ_PROJECT_NAMES =
  'select({nameAr: projects.name_ar, nameEn: projects.name_en}).from(table:projects).where(sql("projects"."id" = $1 ["55555555-5555-4555-8555-555555555555"])).limit(1)';
const LOCK_NUMBERING = 'execute(sql(select pg_advisory_xact_lock(hashtext($1)) ["o-1:design_engagement"]))';
const READ_NEXT_NUMBER = 'execute(sql(select coalesce(max("number"), 0) + 1 as next from public."design_engagements" []))';
const READ_PROJECT_DELIVERIES =
  'select({number: design_engagements.number, createdAt: design_engagements.created_at, state: design_engagements.state, clientId: design_engagements.client_id}).from(table:design_engagements).where(sql(("design_engagements"."project_id" = $1 and "design_engagements"."state" <> $2) ["55555555-5555-4555-8555-555555555555","abandoned"]))';
const INSERT_WITH_PROJECT_NAMES =
  'insert(table:design_engagements).values({orgId: "o-1", number: 7, titleAr: "فيلا", titleEn: "Villa", clientId: "44444444-4444-4444-8444-444444444444", projectId: "55555555-5555-4555-8555-555555555555", state: "created", offPlan: false}).returning({id: design_engagements.id})';
const INSERT_WITH_TYPED_ENGLISH_TITLE =
  'insert(table:design_engagements).values({orgId: "o-1", number: 7, titleAr: null, titleEn: "Tower", clientId: "44444444-4444-4444-8444-444444444444", projectId: "55555555-5555-4555-8555-555555555555", state: "created", offPlan: false}).returning({id: design_engagements.id})';
const INSERT_OFF_PLAN =
  'insert(table:design_engagements).values({orgId: "o-1", number: 7, titleAr: "فيلا", titleEn: "Villa", clientId: "44444444-4444-4444-8444-444444444444", projectId: "55555555-5555-4555-8555-555555555555", state: "created", offPlan: true}).returning({id: design_engagements.id})';
const AUDIT_CREATED =
  'audit {entity: "design_engagement", entityId: "eng-9", action: "create", before: null, after: {number: 7, client_id: "44444444-4444-4444-8444-444444444444", project_id: "55555555-5555-4555-8555-555555555555"}}';

const UP_TO_THE_SLOT_CHECK = ['begin', READ_CLIENT, READ_PROJECT_NAMES, LOCK_NUMBERING, READ_NEXT_NUMBER, READ_PROJECT_DELIVERIES];

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const viewer: OrgContext = { ...owner, role: 'viewer' };

const choice = { clientId: CLIENT_ID, projectId: PROJECT_ID };
const client = [{ id: CLIENT_ID }];
const projectNames = [{ nameAr: ' فيلا ', nameEn: 'Villa' }];
const lockTaken = [{ pg_advisory_xact_lock: '' }];
const nextNumber = [{ next: 7 }];
const created = [{ id: 'eng-9' }];
const deliveryOf = (state: string, clientId: string) => ({
  number: 3,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  state,
  clientId,
});

/** A scripted result that makes its statement REJECT, the way the driver refuses a constraint. */
const refusedBy = (constraint: string) => ({
  then: (_resolve: unknown, reject: (reason: unknown) => void) => reject({ code: '23505', constraint_name: constraint }),
});

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
  entitlement.enabled = true;
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => log.mockRestore());
afterAll(() => vi.useRealTimers());

describe('createEngagementCore, before a transaction opens', () => {
  it('E1 a blank client is refused under clientId', async () => {
    expect(await createEngagementCore(owner, { ...choice, clientId: '  ' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { clientId: { code: 'engagement_client_required' } },
    });
    expectTrace([], 0);
  });

  it('E1 both choices blank are refused together, each under its field', async () => {
    expect(await createEngagementCore(owner, { clientId: '', projectId: '' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: {
        clientId: { code: 'engagement_client_required' },
        projectId: { code: 'engagement_project_required' },
      },
    });
    expectTrace([], 0);
  });

  it('E2 a client id that is no id is the form-level engagement_client_required', async () => {
    expect(await createEngagementCore(owner, { ...choice, clientId: 'x' })).toEqual({
      ok: false,
      error: 'engagement_client_required',
    });
    expectTrace([], 0);
  });

  it('E3 the client shape is checked BEFORE the project shape', async () => {
    expect(await createEngagementCore(owner, { clientId: 'x', projectId: 'x' })).toEqual({
      ok: false,
      error: 'engagement_client_required',
    });
    expectTrace([], 0);
  });

  it('E4 a project id that is no id is engagement_project_required', async () => {
    expect(await createEngagementCore(owner, { ...choice, projectId: 'x' })).toEqual({
      ok: false,
      error: 'engagement_project_required',
    });
    expectTrace([], 0);
  });

  it('the id shapes are checked BEFORE the capability: a viewer with a bad id hears about the id', async () => {
    expect(await createEngagementCore(viewer, { ...choice, clientId: 'x' })).toEqual({
      ok: false,
      error: 'engagement_client_required',
    });
    expectTrace([], 0);
  });

  it('a viewer with valid choices is forbidden, opening nothing', async () => {
    expect(await createEngagementCore(viewer, choice)).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });

  it('a workspace without the flow is refused inside the transaction, before any statement', async () => {
    entitlement.enabled = false;
    expect(await createEngagementCore(owner, choice)).toEqual({ ok: false, error: 'flow_not_enabled' });
    expectTrace(['begin', 'end'], 0);
  });
});

describe('createEngagementCore, the reads and their refusals', () => {
  it('E5 a client that no longer resolves is refused under clientId, the project never read', async () => {
    db.respond([]);
    expect(await createEngagementCore(owner, choice)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { clientId: { code: 'no_longer_exists' } },
    });
    expectTrace(['begin', READ_CLIENT, 'end'], 0);
  });

  it('E6 a project that no longer resolves is refused under projectId', async () => {
    db.respond(client, []);
    expect(await createEngagementCore(owner, choice)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { projectId: { code: 'no_longer_exists' } },
    });
    expectTrace(['begin', READ_CLIENT, READ_PROJECT_NAMES, 'end'], 0);
  });

  it('E7 no typed title and a project with no names is refused under title BEFORE a number is taken', async () => {
    db.respond(client, [{ nameAr: null, nameEn: '  ' }]);
    expect(await createEngagementCore(owner, { ...choice, titleAr: '  ', titleEn: null })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { title: { code: 'engagement_title_required' } },
    });
    expectTrace(['begin', READ_CLIENT, READ_PROJECT_NAMES, 'end'], 0);
  });

  it('E8 a live delivery on the project is project_delivery_exists, read AFTER the numbering lock and the number', async () => {
    db.respond(client, projectNames, lockTaken, nextNumber, [deliveryOf('created', 'another-client')]);
    expect(await createEngagementCore(owner, choice)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { projectId: { code: 'project_delivery_exists' } },
    });
    expectTrace([...UP_TO_THE_SLOT_CHECK, 'end'], 0);
  });

  it('E8 a finished delivery of the SAME client on the project is project_client_has_delivery, naming it', async () => {
    db.respond(client, projectNames, lockTaken, nextNumber, [deliveryOf('closed_design_only', CLIENT_ID)]);
    expect(await createEngagementCore(owner, choice)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { projectId: { code: 'project_client_has_delivery', params: { delivery: 'DE-2026-0003' } } },
    });
    expectTrace([...UP_TO_THE_SLOT_CHECK, 'end'], 0);
  });
});

describe('createEngagementCore, the delivery row and its audit', () => {
  it('E9 with no typed title the delivery takes the project names, trimmed; offPlan defaults to false', async () => {
    db.respond(client, projectNames, lockTaken, nextNumber, [], created);
    expect(await createEngagementCore(owner, choice)).toEqual({ ok: true, data: 'eng-9' });
    expectTrace([...UP_TO_THE_SLOT_CHECK, INSERT_WITH_PROJECT_NAMES, AUDIT_CREATED, 'end'], 0);
  });

  it('E10 one typed title is kept and the other stays null: the project names are not mixed in', async () => {
    db.respond(client, projectNames, lockTaken, nextNumber, [], created);
    expect(await createEngagementCore(owner, { ...choice, titleEn: ' Tower ' })).toEqual({ ok: true, data: 'eng-9' });
    expectTrace([...UP_TO_THE_SLOT_CHECK, INSERT_WITH_TYPED_ENGLISH_TITLE, AUDIT_CREATED, 'end'], 0);
  });

  it('E11 offPlan true is stored, and padded ids are trimmed in every statement', async () => {
    db.respond(client, projectNames, lockTaken, nextNumber, [], created);
    const padded = { clientId: ` ${CLIENT_ID} `, projectId: ` ${PROJECT_ID} `, offPlan: true };
    expect(await createEngagementCore(owner, padded)).toEqual({ ok: true, data: 'eng-9' });
    expectTrace([...UP_TO_THE_SLOT_CHECK, INSERT_OFF_PLAN, AUDIT_CREATED, 'end'], 0);
  });
});

describe('createEngagementCore, the races its insert can lose', () => {
  it('the one-active-delivery index is answered project_delivery_exists under projectId, silently', async () => {
    db.respond(client, projectNames, lockTaken, nextNumber, [], refusedBy('design_engagements_one_active_per_project_uniq'));
    expect(await createEngagementCore(owner, choice)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { projectId: { code: 'project_delivery_exists' } },
    });
    expectTrace([...UP_TO_THE_SLOT_CHECK, INSERT_WITH_PROJECT_NAMES, 'end'], 0);
  });

  it('the client same-org key is answered no_longer_exists under clientId, silently', async () => {
    db.respond(client, projectNames, lockTaken, nextNumber, [], refusedBy('design_engagements_client_same_org_fk'));
    expect(await createEngagementCore(owner, choice)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { clientId: { code: 'no_longer_exists' } },
    });
    expectTrace([...UP_TO_THE_SLOT_CHECK, INSERT_WITH_PROJECT_NAMES, 'end'], 0);
  });

  it('the project same-org key is answered no_longer_exists under projectId, silently', async () => {
    db.respond(client, projectNames, lockTaken, nextNumber, [], refusedBy('design_engagements_project_same_org_fk'));
    expect(await createEngagementCore(owner, choice)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { projectId: { code: 'no_longer_exists' } },
    });
    expectTrace([...UP_TO_THE_SLOT_CHECK, INSERT_WITH_PROJECT_NAMES, 'end'], 0);
  });

  it('a constraint the core did not name stays in the logged tail: generic, one line', async () => {
    db.respond(client, projectNames, lockTaken, nextNumber, [], refusedBy('design_engagements_org_id_number_unique'));
    expect(await createEngagementCore(owner, choice)).toMatchObject({ ok: false, error: 'generic' });
    expectTrace([...UP_TO_THE_SLOT_CHECK, INSERT_WITH_PROJECT_NAMES, 'end'], 1);
  });
});
