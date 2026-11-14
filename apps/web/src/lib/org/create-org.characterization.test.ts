// CHARACTERIZATION of createOrgCore, the path that founds a studio: what it
// answers and, statement by statement, what it asks the database on every
// branch. Written against the code as it stood BEFORE it was split into named
// phases, and not edited since: a refactor that changes a statement, its
// parameters, the order, an early return, the context the transaction is opened
// with or the audit row fails here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; the profile rules and the firm-type registry run for real (the
// registry branches no real entry reaches are in
// create-org-firm-types.characterization.test.ts). What a real Postgres adds (the
// trigger that admits the founder's owner membership, RLS on every later insert,
// the foreign keys) is proven in tests/actions/createOrg.dbtest.ts and
// membership-role-writer-bootstrap.dbtest.ts.
//
// The four catalogue inserts are compared with strings this file builds from the
// exported defaults with its OWN column mapping, so a seed label can change
// without touching this file while a dropped column, table, row or a changed
// order cannot. Every other entry is the literal the unsplit core journalled.
import {
  DEFAULT_PROJECT_TYPES,
  DEFAULT_SECTIONS,
  DEFAULT_STAGE_TEMPLATES,
  defaultDocumentCategories,
} from '@metra/db';
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

const { createOrgCore } = await import('./core');

// The statements, exactly as the unsplit core issued them.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const MINT_ACCOUNT = 'execute(sql(select id from public.app_bootstrap_account($1, $2) [null,"Acme Fit-out"]))';
const INSERT_STUDIO =
  'insert(table:organizations).values({id: "o-1", accountId: "acc-1", nameEn: "Acme Fit-out", nameAr: null, city: "Cairo", taxRegistrationNumber: null, defaultLocale: "ar-EG"})';
const INSERT_STUDIO_WITHOUT_ACCOUNT =
  'insert(table:organizations).values({id: "o-1", accountId: undefined, nameEn: "Acme Fit-out", nameAr: null, city: "Cairo", taxRegistrationNumber: null, defaultLocale: "ar-EG"})';
const INSERT_OWNER = 'insert(table:memberships).values({orgId: "o-1", userId: "u-1", role: "owner"})';
const INSERT_ENTITLEMENTS = 'insert(table:workspace_entitlements).values({orgId: "o-1", enabledFlows: ["interior"]})';
const INSERT_AUTOMATION = 'insert(table:automation_settings).values({orgId: "o-1"})';
const AUDIT_FOUNDED =
  'audit {entity: "organization", entityId: "o-1", action: "create", before: null, after: {nameEn: "Acme Fit-out", nameAr: null, city: "Cairo", taxRegistrationNumber: null}}';

// The same, for the second studio: another org, another founder, an Arabic name.
const BEGIN_SECOND = 'begin [{orgId: "o-2", userId: "u-2", role: "viewer"}, {write: true, capTransaction: undefined}]';
const MINT_ACCOUNT_SECOND = 'execute(sql(select id from public.app_bootstrap_account($1, $2) ["ستوديو النيل",null]))';
const INSERT_STUDIO_SECOND =
  'insert(table:organizations).values({id: "o-2", accountId: "acc-2", nameEn: null, nameAr: "ستوديو النيل", city: null, taxRegistrationNumber: "123-456", defaultLocale: "ar-EG"})';
const INSERT_OWNER_SECOND = 'insert(table:memberships).values({orgId: "o-2", userId: "u-2", role: "owner"})';
const INSERT_ENTITLEMENTS_SECOND = 'insert(table:workspace_entitlements).values({orgId: "o-2", enabledFlows: ["interior"]})';
const INSERT_AUTOMATION_SECOND = 'insert(table:automation_settings).values({orgId: "o-2"})';
const AUDIT_FOUNDED_SECOND =
  'audit {entity: "organization", entityId: "o-2", action: "create", before: null, after: {nameEn: null, nameAr: "ستوديو النيل", city: null, taxRegistrationNumber: "123-456"}}';

const seeded = (table: string, rows: object[]) => `insert(table:${table}).values(${db.render(rows)})`;

/** The four catalogue inserts for one studio, in the order the core runs them. Sections carry no sortOrder. */
const seedsOf = (orgId: string): string[] => [
  seeded(
    'sections',
    DEFAULT_SECTIONS.map((section) => ({ orgId, key: section.key, nameEn: section.nameEn, nameAr: section.nameAr })),
  ),
  seeded(
    'project_types',
    DEFAULT_PROJECT_TYPES.map((type) => ({
      orgId,
      key: type.key,
      nameEn: type.nameEn,
      nameAr: type.nameAr,
      sortOrder: type.sortOrder,
    })),
  ),
  seeded(
    'stage_templates',
    DEFAULT_STAGE_TEMPLATES.map((stage) => ({
      orgId,
      key: stage.key,
      nameEn: stage.nameEn,
      nameAr: stage.nameAr,
      sortOrder: stage.sortOrder,
    })),
  ),
  seeded(
    'document_categories',
    defaultDocumentCategories().map((category) => ({
      orgId,
      key: category.key,
      nameEn: category.nameEn,
      nameAr: category.nameAr,
      sortOrder: category.sortOrder,
    })),
  ),
];

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const secondFounder: OrgContext = { orgId: 'o-2', userId: 'u-2', role: 'viewer' };

const acme = { nameEn: ' Acme Fit-out ', city: 'Cairo' };
const account = [{ id: 'acc-1' }];
/** The eight writes after the account whose result the core never reads. */
const eightWrites = [[], [], [], [], [], [], [], []];

/** A scripted result that makes its statement REJECT, the way the driver refuses it. */
const rejectedWith = (failure: object) => ({
  then: (_resolve: unknown, reject: (reason: unknown) => void) => reject(failure),
});

let log: ReturnType<typeof vi.spyOn>;

/** The journal, that every scripted result was consumed, and how many lines were logged. */
function expectTrace(journal: string[], logged: number): void {
  expect(db.journal).toEqual(journal);
  expect(db.pending()).toBe(0);
  expect(log).toHaveBeenCalledTimes(logged);
}

/** The one line a generic answer logs is mutateInOrg's own. */
function expectGenericLogLine(): void {
  expect(log.mock.calls[0]?.[0]).toBe('mutateInOrg failed');
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

describe('the catalogue expectations this file computes', () => {
  it('each of the four default lists has rows, so no expected insert is an empty one', () => {
    expect(DEFAULT_SECTIONS.length).toBeGreaterThan(0);
    expect(DEFAULT_PROJECT_TYPES.length).toBeGreaterThan(0);
    expect(DEFAULT_STAGE_TEMPLATES.length).toBeGreaterThan(0);
    expect(defaultDocumentCategories().length).toBeGreaterThan(0);
  });

  it('the four expected inserts differ from each other, so a swapped pair is seen', () => {
    expect(new Set(seedsOf('o-1')).size).toBe(4);
  });
});

describe('createOrgCore, before a transaction opens', () => {
  it('O1 no name at all is refused under name', async () => {
    expect(await createOrgCore(owner, {})).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { name: { code: 'name_required' } },
    });
    expectTrace([], 0);
  });

  it('O2 the profile is read BEFORE the firm type: no name and an unavailable type hears about the name', async () => {
    expect(await createOrgCore(owner, { firmType: 'construction' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { name: { code: 'name_required' } },
    });
    expectTrace([], 0);
  });

  it('O3 a firm type that is not available yet is firm_type_unavailable', async () => {
    expect(await createOrgCore(owner, { nameEn: 'Acme', firmType: 'construction' })).toEqual({
      ok: false,
      error: 'firm_type_unavailable',
    });
    expectTrace([], 0);
  });

  it('O4 the other unavailable firm type is refused the same way', async () => {
    expect(await createOrgCore(owner, { nameEn: 'Acme', firmType: 'both' })).toEqual({
      ok: false,
      error: 'firm_type_unavailable',
    });
    expectTrace([], 0);
  });

  it('O5 a key the registry does not have is firm_type_unavailable, not a crash', async () => {
    expect(await createOrgCore(owner, { nameEn: 'Acme', firmType: 'bogus' as never })).toEqual({
      ok: false,
      error: 'firm_type_unavailable',
    });
    expectTrace([], 0);
  });
});

describe('createOrgCore, the founding transaction', () => {
  it('O6 the account, the studio with no RETURNING, the owner membership, the workspace, the four catalogues, the audit', async () => {
    db.respond(account, ...eightWrites);
    expect(await createOrgCore(owner, acme)).toEqual({ ok: true, data: undefined });
    expectTrace(
      [
        BEGIN,
        MINT_ACCOUNT,
        INSERT_STUDIO,
        INSERT_OWNER,
        INSERT_ENTITLEMENTS,
        INSERT_AUTOMATION,
        ...seedsOf('o-1'),
        AUDIT_FOUNDED,
        'end',
      ],
      0,
    );
  });

  it('O7 another org and founder are carried through every statement; the context role is not what is written', async () => {
    db.respond([{ id: 'acc-2' }], ...eightWrites);
    const input = { nameAr: 'ستوديو النيل', taxRegistrationNumber: ' 123-456 ', firmType: 'interior' as const };
    expect(await createOrgCore(secondFounder, input)).toEqual({ ok: true, data: undefined });
    expectTrace(
      [
        BEGIN_SECOND,
        MINT_ACCOUNT_SECOND,
        INSERT_STUDIO_SECOND,
        INSERT_OWNER_SECOND,
        INSERT_ENTITLEMENTS_SECOND,
        INSERT_AUTOMATION_SECOND,
        ...seedsOf('o-2'),
        AUDIT_FOUNDED_SECOND,
        'end',
      ],
      0,
    );
  });

  it('O8 a bootstrap function that answers no row is not refused: the studio is written with no account', async () => {
    db.respond([], ...eightWrites);
    expect(await createOrgCore(owner, acme)).toEqual({ ok: true, data: undefined });
    expectTrace(
      [
        BEGIN,
        MINT_ACCOUNT,
        INSERT_STUDIO_WITHOUT_ACCOUNT,
        INSERT_OWNER,
        INSERT_ENTITLEMENTS,
        INSERT_AUTOMATION,
        ...seedsOf('o-1'),
        AUDIT_FOUNDED,
        'end',
      ],
      0,
    );
  });
});

describe('createOrgCore, a write the database refuses', () => {
  it('O9 the membership refused by the role trigger (MT150) is generic with one line, and nothing follows it', async () => {
    db.respond(account, [], rejectedWith({ code: 'MT150' }));
    expect(await createOrgCore(owner, acme)).toMatchObject({ ok: false, error: 'generic' });
    expectTrace([BEGIN, MINT_ACCOUNT, INSERT_STUDIO, INSERT_OWNER, 'end'], 1);
    expectGenericLogLine();
  });

  it('O10 the studio row refused on its key names no refusal: generic with one line, no membership', async () => {
    db.respond(account, rejectedWith({ code: '23505', constraint_name: 'organizations_pkey' }));
    expect(await createOrgCore(owner, acme)).toMatchObject({ ok: false, error: 'generic' });
    expectTrace([BEGIN, MINT_ACCOUNT, INSERT_STUDIO, 'end'], 1);
    expectGenericLogLine();
  });
});
