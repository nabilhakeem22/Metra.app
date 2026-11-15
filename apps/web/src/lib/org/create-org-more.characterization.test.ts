// MORE CHARACTERIZATION of createOrgCore, beside the files committed before the
// split (which are not edited): the audit row that closes the founding, awaited,
// and answered as the unsplit code answers when the database refuses it. And a
// firm type sent as an empty string, which is not the same as none sent.
// Same recording double and conventions, with one difference in the audit double
// (below); the four catalogue inserts are computed from the exported defaults
// with this file's own column mapping, as in the first file. Every scenario is
// green on the unsplit code and on the split code alike.
import {
  DEFAULT_PROJECT_TYPES,
  DEFAULT_SECTIONS,
  DEFAULT_STAGE_TEMPLATES,
  defaultDocumentCategories,
} from '@metra/db';
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

const { createOrgCore } = await import('./core');

// The statements, exactly as the unsplit core issues them for a third studio:
// not an org, a founder or an account the first file uses, and both names typed.
const BEGIN = 'begin [{orgId: "o-3", userId: "u-3", role: "owner"}, {write: true, capTransaction: undefined}]';
const MINT_ACCOUNT =
  'execute(sql(select id from public.app_bootstrap_account($1, $2) ["ستوديو الدلتا","Delta Studio"]))';
const INSERT_STUDIO =
  'insert(table:organizations).values({id: "o-3", accountId: "acc-3", nameEn: "Delta Studio", nameAr: "ستوديو الدلتا", city: "Mansoura", taxRegistrationNumber: "555-777", defaultLocale: "ar-EG"})';
const INSERT_OWNER = 'insert(table:memberships).values({orgId: "o-3", userId: "u-3", role: "owner"})';
const INSERT_ENTITLEMENTS = 'insert(table:workspace_entitlements).values({orgId: "o-3", enabledFlows: ["interior"]})';
const INSERT_AUTOMATION = 'insert(table:automation_settings).values({orgId: "o-3"})';
const AUDIT_FOUNDED =
  'audit {entity: "organization", entityId: "o-3", action: "create", before: null, after: {nameEn: "Delta Studio", nameAr: "ستوديو الدلتا", city: "Mansoura", taxRegistrationNumber: "555-777"}}';
const AUDIT_REFUSED =
  'audit refused {entity: "organization", entityId: "o-3", action: "create", before: null, after: {nameEn: "Delta Studio", nameAr: "ستوديو الدلتا", city: "Mansoura", taxRegistrationNumber: "555-777"}}';

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

const UP_TO_THE_LAST_CATALOGUE = [
  BEGIN,
  MINT_ACCOUNT,
  INSERT_STUDIO,
  INSERT_OWNER,
  INSERT_ENTITLEMENTS,
  INSERT_AUTOMATION,
  ...seedsOf('o-3'),
];

const thirdFounder: OrgContext = { orgId: 'o-3', userId: 'u-3', role: 'owner' };

const delta = { nameEn: 'Delta Studio', nameAr: 'ستوديو الدلتا', city: 'Mansoura', taxRegistrationNumber: '555-777' };
const account = [{ id: 'acc-3' }];
/** The eight writes after the account whose result the core never reads. */
const eightWrites = [[], [], [], [], [], [], [], []];

/** The logged tail's answer, whole: its reference is random. */
const GENERIC = { ok: false, error: 'generic', reference: expect.any(String) };

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

describe('createOrgCore, the audit row that closes the founding', () => {
  it('O11 a third studio with both names: the audit row has landed after the last catalogue and before the transaction ends', async () => {
    db.respond(account, ...eightWrites);
    expect(await settled(createOrgCore(thirdFounder, delta))).toEqual({ ok: true, data: undefined });
    expectTrace([...UP_TO_THE_LAST_CATALOGUE, AUDIT_FOUNDED, 'end'], 0);
  });

  it('O12 an audit row the database refuses is the answer: generic with one line, inside the transaction, and no rejection escapes', async () => {
    auditInsert.refusal = { code: '42501' };
    db.respond(account, ...eightWrites);
    expect(await settled(createOrgCore(thirdFounder, delta))).toEqual(GENERIC);
    expectTrace([...UP_TO_THE_LAST_CATALOGUE, AUDIT_REFUSED, 'end'], 1);
    expect(log.mock.calls[0]?.[0]).toBe('mutateInOrg failed');
  });
});

describe('createOrgCore, a firm type sent as an empty string', () => {
  it('O13 only a firm type that was NOT sent defaults to interior: an empty one is looked up as it is, and is firm_type_unavailable', async () => {
    expect(await settled(createOrgCore(thirdFounder, { ...delta, firmType: '' as never }))).toEqual({
      ok: false,
      error: 'firm_type_unavailable',
    });
    expectTrace([], 0);
  });
});
