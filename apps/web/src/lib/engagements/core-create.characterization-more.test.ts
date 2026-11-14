// MORE CHARACTERIZATION of createEngagementCore, beside the file committed before the
// split (which is not edited): a project that has only one of its
// two names lends that one, and the other title stays empty.
// Same recording double and conventions; written against the split code.
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

// The statements, exactly as the core issues them.
const READ_CLIENT =
  'select({id: clients.id}).from(table:clients).where(sql("clients"."id" = $1 ["44444444-4444-4444-8444-444444444444"])).limit(1)';
const READ_PROJECT_NAMES =
  'select({nameAr: projects.name_ar, nameEn: projects.name_en}).from(table:projects).where(sql("projects"."id" = $1 ["55555555-5555-4555-8555-555555555555"])).limit(1)';
const LOCK_NUMBERING = 'execute(sql(select pg_advisory_xact_lock(hashtext($1)) ["o-1:design_engagement"]))';
const READ_NEXT_NUMBER = 'execute(sql(select coalesce(max("number"), 0) + 1 as next from public."design_engagements" []))';
const READ_PROJECT_DELIVERIES =
  'select({number: design_engagements.number, createdAt: design_engagements.created_at, state: design_engagements.state, clientId: design_engagements.client_id}).from(table:design_engagements).where(sql(("design_engagements"."project_id" = $1 and "design_engagements"."state" <> $2) ["55555555-5555-4555-8555-555555555555","abandoned"]))';
const INSERT_WITH_ENGLISH_NAME_ONLY =
  'insert(table:design_engagements).values({orgId: "o-1", number: 7, titleAr: null, titleEn: "Villa", clientId: "44444444-4444-4444-8444-444444444444", projectId: "55555555-5555-4555-8555-555555555555", state: "created", offPlan: false}).returning({id: design_engagements.id})';
const INSERT_WITH_ARABIC_NAME_ONLY =
  'insert(table:design_engagements).values({orgId: "o-1", number: 7, titleAr: "فيلا", titleEn: null, clientId: "44444444-4444-4444-8444-444444444444", projectId: "55555555-5555-4555-8555-555555555555", state: "created", offPlan: false}).returning({id: design_engagements.id})';
const AUDIT_CREATED =
  'audit {entity: "design_engagement", entityId: "eng-9", action: "create", before: null, after: {number: 7, client_id: "44444444-4444-4444-8444-444444444444", project_id: "55555555-5555-4555-8555-555555555555"}}';

const UP_TO_THE_SLOT_CHECK = ['begin', READ_CLIENT, READ_PROJECT_NAMES, LOCK_NUMBERING, READ_NEXT_NUMBER, READ_PROJECT_DELIVERIES];

const choice = { clientId: CLIENT_ID, projectId: PROJECT_ID };
const client = [{ id: CLIENT_ID }];
const lockTaken = [{ pg_advisory_xact_lock: '' }];
const nextNumber = [{ next: 7 }];
const created = [{ id: 'eng-9' }];

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };

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

describe('createEngagementCore, a project with only one of its two names', () => {
  it('only an English name: the delivery takes it as titleEn and titleAr stays null', async () => {
    db.respond(client, [{ nameAr: null, nameEn: 'Villa' }], lockTaken, nextNumber, [], created);
    expect(await createEngagementCore(owner, choice)).toEqual({ ok: true, data: 'eng-9' });
    expectTrace([...UP_TO_THE_SLOT_CHECK, INSERT_WITH_ENGLISH_NAME_ONLY, AUDIT_CREATED, 'end'], 0);
  });

  it('only an Arabic name: the delivery takes it as titleAr and titleEn stays null', async () => {
    db.respond(client, [{ nameAr: 'فيلا', nameEn: null }], lockTaken, nextNumber, [], created);
    expect(await createEngagementCore(owner, choice)).toEqual({ ok: true, data: 'eng-9' });
    expectTrace([...UP_TO_THE_SLOT_CHECK, INSERT_WITH_ARABIC_NAME_ONLY, AUDIT_CREATED, 'end'], 0);
  });
});
