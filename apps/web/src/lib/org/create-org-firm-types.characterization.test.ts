// CHARACTERIZATION of createOrgCore's firm-type gates, the four branches the real
// registry cannot reach: its one available type has a single registered flow, so
// an empty flow list, an unregistered flow, a list the core must pass through as
// it is, and an entry switched off are only reachable with the registry doubled.
// Written against the code as it stood BEFORE it was split into named phases,
// and not edited since.
//
// Doubled here and nowhere else: @/lib/entitlements/firm-types (pure, it issues
// no statement). Everything else is as in create-org.characterization.test.ts:
// the recording double (src/test/recording-tx.ts) under the REAL mutateInOrg, and
// the four catalogue inserts compared with strings built from the exported
// defaults with this file's own column mapping.
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
const registry: Record<string, { enabledFlows: string[]; available: boolean } | undefined> = {};
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
vi.mock('@/lib/entitlements/firm-types', () => ({
  firmTypeDef: (key: string) => registry[key],
}));

const { createOrgCore } = await import('./core');

// The statements, exactly as the unsplit core issued them.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const MINT_ACCOUNT = 'execute(sql(select id from public.app_bootstrap_account($1, $2) [null,"Acme Fit-out"]))';
const INSERT_STUDIO =
  'insert(table:organizations).values({id: "o-1", accountId: "acc-1", nameEn: "Acme Fit-out", nameAr: null, city: "Cairo", taxRegistrationNumber: null, defaultLocale: "ar-EG"})';
const INSERT_OWNER = 'insert(table:memberships).values({orgId: "o-1", userId: "u-1", role: "owner"})';
const INSERT_ENTITLEMENTS_AS_LISTED =
  'insert(table:workspace_entitlements).values({orgId: "o-1", enabledFlows: ["interior", "interior"]})';
const INSERT_AUTOMATION = 'insert(table:automation_settings).values({orgId: "o-1"})';
const AUDIT_FOUNDED =
  'audit {entity: "organization", entityId: "o-1", action: "create", before: null, after: {nameEn: "Acme Fit-out", nameAr: null, city: "Cairo", taxRegistrationNumber: null}}';

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
const acme = { nameEn: ' Acme Fit-out ', city: 'Cairo' };

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
  delete registry.interior;
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => log.mockRestore());
afterAll(() => vi.useRealTimers());

describe('createOrgCore, a firm type refused before a transaction opens', () => {
  it('T1 an available type with no flow at all is firm_type_unavailable', async () => {
    registry.interior = { enabledFlows: [], available: true };
    expect(await createOrgCore(owner, acme)).toEqual({ ok: false, error: 'firm_type_unavailable' });
    expectTrace([], 0);
  });

  it('T2 an available type that lists a flow nobody registered is firm_type_unavailable', async () => {
    registry.interior = { enabledFlows: ['interior', 'construction'], available: true };
    expect(await createOrgCore(owner, acme)).toEqual({ ok: false, error: 'firm_type_unavailable' });
    expectTrace([], 0);
  });

  it('T4 a type whose flows are all registered but which is switched off is firm_type_unavailable', async () => {
    registry.interior = { enabledFlows: ['interior'], available: false };
    expect(await createOrgCore(owner, acme)).toEqual({ ok: false, error: 'firm_type_unavailable' });
    expectTrace([], 0);
  });
});

describe('createOrgCore, the flows the workspace is given', () => {
  it('T3 the entitlements carry the flow list of the firm type exactly as the registry gives it', async () => {
    registry.interior = { enabledFlows: ['interior', 'interior'], available: true };
    db.respond([{ id: 'acc-1' }], [], [], [], [], [], [], [], []);
    expect(await createOrgCore(owner, acme)).toEqual({ ok: true, data: undefined });
    expectTrace(
      [
        BEGIN,
        MINT_ACCOUNT,
        INSERT_STUDIO,
        INSERT_OWNER,
        INSERT_ENTITLEMENTS_AS_LISTED,
        INSERT_AUTOMATION,
        ...seedsOf('o-1'),
        AUDIT_FOUNDED,
        'end',
      ],
      0,
    );
  });
});
