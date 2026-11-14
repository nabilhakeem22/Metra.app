// CHARACTERIZATION of recordArtifactCore: what it answers and, statement by
// statement, what it asks the database on every branch. Written against the code
// as it stood BEFORE it was split into named phases, and not edited since: a
// refactor that changes a statement, its parameters, the order, an early return,
// a thrown code or the audit row fails here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; artifact-fences and the text rules run for real. What a real
// Postgres adds (the delivery row lock, RLS on the file read) is proven in
// tests/actions/engagements-deliverables.dbtest.ts and delivery-documents.dbtest.ts.
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

const { recordArtifactCore } = await import('./artifacts');
const { CONCEPT_OPTION_MAX } = await import('./concept-options');
const { MAX_LABEL_CHARS } = await import('@/lib/validation/text');

const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';

// The statements, exactly as the unsplit core issued them.
const READ_ENGAGEMENT =
  'select({id: design_engagements.id, state: design_engagements.state}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["11111111-1111-4111-8111-111111111111"])).limit(1)';
const LOCK_ENGAGEMENT =
  'select({id: design_engagements.id}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["11111111-1111-4111-8111-111111111111"])).for("update")';
const READ_ARTIFACT_OF_FILE =
  'select({id: engagement_artifacts.id}).from(table:engagement_artifacts).where(sql(("engagement_artifacts"."engagement_id" = $1 and "engagement_artifacts"."file_id" = $2) ["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"])).limit(1)';
const COUNT_CONCEPT_OPTIONS =
  'select({recorded: sql(count(*) [])}).from(table:engagement_artifacts).where(sql(("engagement_artifacts"."engagement_id" = $1 and "engagement_artifacts"."kind" = $2) ["11111111-1111-4111-8111-111111111111","concept_option"]))';
const READ_OWN_UPLOAD =
  'select({id: files.id}).from(table:files).where(sql(("files"."id" = $1 and "files"."entity" = $2 and "files"."entity_id" = $3) ["22222222-2222-4222-8222-222222222222","engagement","11111111-1111-4111-8111-111111111111"])).limit(1)';
const INSERT_SURVEY_WITH_FILE =
  'insert(table:engagement_artifacts).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "survey", fileId: "22222222-2222-4222-8222-222222222222", contentHash: "abc", label: "Plan", attestedBy: "u-1", note: "n"}).returning({id: engagement_artifacts.id})';
const INSERT_BARE_SURVEY =
  'insert(table:engagement_artifacts).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "survey", fileId: null, contentHash: null, label: null, attestedBy: "u-1", note: null}).returning({id: engagement_artifacts.id})';
const INSERT_BARE_CONCEPT_OPTION =
  'insert(table:engagement_artifacts).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "concept_option", fileId: null, contentHash: null, label: null, attestedBy: "u-1", note: null}).returning({id: engagement_artifacts.id})';
const AUDIT_SURVEY =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "create", before: null, after: {artifact_id: "art-1", kind: "survey"}}';
const AUDIT_CONCEPT_OPTION =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "create", before: null, after: {artifact_id: "art-1", kind: "concept_option"}}';

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const viewer: OrgContext = { ...owner, role: 'viewer' };

const survey = { engagementId: ENGAGEMENT_ID, kind: 'survey' as const };
const conceptOption = { engagementId: ENGAGEMENT_ID, kind: 'concept_option' as const };
const unknownKind = { engagementId: ENGAGEMENT_ID, kind: 'nope' as never };
const liveEngagement = [{ id: ENGAGEMENT_ID, state: 'created' }];

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

describe('recordArtifactCore, before a transaction opens', () => {
  it('A1 a kind no picker offers is malformed', async () => {
    expect(await recordArtifactCore(owner, unknownKind)).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('A2 a file id that is no id is malformed', async () => {
    expect(await recordArtifactCore(owner, { ...survey, fileId: 'x' })).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('A2 the file id is checked BEFORE the text: a bad file id with an over-long label is malformed', async () => {
    expect(await recordArtifactCore(owner, { ...survey, fileId: 'x', label: 'x'.repeat(300) })).toEqual({
      ok: false,
      error: 'malformed',
    });
    expectTrace([], 0);
  });

  it('A3 the kind is checked BEFORE the text: a bad kind with an over-long label is malformed', async () => {
    expect(await recordArtifactCore(owner, { ...unknownKind, label: 'x'.repeat(300) })).toEqual({
      ok: false,
      error: 'malformed',
    });
    expectTrace([], 0);
  });

  it('A4 a label one character over the cap is refused under label', async () => {
    expect(await recordArtifactCore(owner, { ...survey, label: 'x'.repeat(MAX_LABEL_CHARS + 1) })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { label: { code: 'too_long', params: { max: 200 } } },
    });
    expectTrace([], 0);
  });

  it('A5 validation runs BEFORE the flow: a workspace without it still hears malformed for a bad kind', async () => {
    entitlement.enabled = false;
    expect(await recordArtifactCore(owner, unknownKind)).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('A5 validation runs BEFORE the capability: a viewer with a bad kind hears malformed', async () => {
    expect(await recordArtifactCore(viewer, unknownKind)).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('a viewer with a valid record is forbidden, opening nothing', async () => {
    expect(await recordArtifactCore(viewer, survey)).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });

  it('a workspace without the flow is refused inside the transaction, before any statement', async () => {
    entitlement.enabled = false;
    expect(await recordArtifactCore(owner, survey)).toEqual({ ok: false, error: 'flow_not_enabled' });
    expectTrace(['begin', 'end'], 0);
  });
});

describe('recordArtifactCore, the fences inside the transaction', () => {
  it('A6 an engagement that does not resolve is engagement_not_found', async () => {
    db.respond([]);
    expect(await recordArtifactCore(owner, survey)).toEqual({ ok: false, error: 'engagement_not_found' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('A7 an abandoned engagement is engagement_not_active, before any lock', async () => {
    db.respond([{ id: ENGAGEMENT_ID, state: 'abandoned' }]);
    expect(await recordArtifactCore(owner, { ...survey, fileId: FILE_ID })).toEqual({
      ok: false,
      error: 'engagement_not_active',
    });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('A8 a retried attach of the same upload answers the artifact already recorded: no insert, no audit', async () => {
    db.respond(liveEngagement, [], [{ id: 'art-0' }]);
    expect(await recordArtifactCore(owner, { ...survey, fileId: FILE_ID })).toEqual({ ok: true, data: 'art-0' });
    expectTrace(['begin', READ_ENGAGEMENT, LOCK_ENGAGEMENT, READ_ARTIFACT_OF_FILE, 'end'], 0);
  });

  it('A9 the concept slot is checked BEFORE file ownership: a full delivery never reads the file', async () => {
    db.respond(liveEngagement, [], [], [], [{ recorded: CONCEPT_OPTION_MAX }]);
    expect(await recordArtifactCore(owner, { ...conceptOption, fileId: FILE_ID })).toEqual({
      ok: false,
      error: 'concept_options_out_of_range',
    });
    expectTrace(
      ['begin', READ_ENGAGEMENT, LOCK_ENGAGEMENT, READ_ARTIFACT_OF_FILE, LOCK_ENGAGEMENT, COUNT_CONCEPT_OPTIONS, 'end'],
      0,
    );
  });

  it('A10 a file that is not this engagement own upload is record_not_found, nothing inserted', async () => {
    db.respond(liveEngagement, [], [], []);
    expect(await recordArtifactCore(owner, { ...survey, fileId: FILE_ID })).toEqual({ ok: false, error: 'record_not_found' });
    expectTrace(['begin', READ_ENGAGEMENT, LOCK_ENGAGEMENT, READ_ARTIFACT_OF_FILE, READ_OWN_UPLOAD, 'end'], 0);
  });
});

describe('recordArtifactCore, the artifact row and its audit', () => {
  it('A11 a survey with a file: read, lock, retry lookup, ownership, insert with the trimmed text, audit', async () => {
    db.respond(liveEngagement, [], [], [{ id: FILE_ID }], [{ id: 'art-1' }]);
    const input = { ...survey, fileId: FILE_ID, contentHash: ' abc ', label: ' Plan ', note: ' n ' };
    expect(await recordArtifactCore(owner, input)).toEqual({ ok: true, data: 'art-1' });
    expectTrace(
      ['begin', READ_ENGAGEMENT, LOCK_ENGAGEMENT, READ_ARTIFACT_OF_FILE, READ_OWN_UPLOAD, INSERT_SURVEY_WITH_FILE, AUDIT_SURVEY, 'end'],
      0,
    );
  });

  it('A12 a survey with no file takes no lock and reads no file: read, insert, audit', async () => {
    db.respond(liveEngagement, [{ id: 'art-1' }]);
    expect(await recordArtifactCore(owner, survey)).toEqual({ ok: true, data: 'art-1' });
    expectTrace(['begin', READ_ENGAGEMENT, INSERT_BARE_SURVEY, AUDIT_SURVEY, 'end'], 0);
  });

  it('A13 a concept option with no file, under the cap: read, lock, count, insert, audit', async () => {
    db.respond(liveEngagement, [], [{ recorded: CONCEPT_OPTION_MAX - 1 }], [{ id: 'art-1' }]);
    expect(await recordArtifactCore(owner, conceptOption)).toEqual({ ok: true, data: 'art-1' });
    expectTrace(
      ['begin', READ_ENGAGEMENT, LOCK_ENGAGEMENT, COUNT_CONCEPT_OPTIONS, INSERT_BARE_CONCEPT_OPTION, AUDIT_CONCEPT_OPTION, 'end'],
      0,
    );
  });
});
