// CHARACTERIZATION of importCostItemsCore: what it answers and, statement by
// statement, what it asks the database on every branch. Written against the code
// as it stood BEFORE it was split into named phases, and not edited since: a
// refactor that changes a statement, its parameters, the order, an early return,
// the per-row answers or the audit row fails here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; validateImportRows and its resolvers run for real. What a real
// Postgres adds (a 500-row insert in one statement, RLS, the code index) is
// proven in tests/actions/costImport.dbtest.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createRecordingTx } from '@/test/recording-tx';
import { MAX_IMPORT_ROWS } from './parse';

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

const { importCostItemsCore } = await import('./import-core');

// The statements, exactly as the unsplit core issued them.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const BEGIN_SECOND = 'begin [{orgId: "o-2", userId: "u-2", role: "admin"}, {write: true, capTransaction: undefined}]';
const READ_LIVE_CODES = 'select({code: cost_items.code}).from(table:cost_items)';
const READ_ACTIVE_SECTIONS =
  'select({id: sections.id, key: sections.key, nameEn: sections.name_en, nameAr: sections.name_ar}).from(table:sections).where(sql("sections"."active" = $1 [true]))';
const INSERT_BOARD_AND_PAINT =
  'insert(table:cost_items).values([{orgId: "o-1", code: "A-1", nameEn: "Board", nameAr: null, sectionId: "s-1", unit: "sqm", defaultUnitCost: "100", defaultUnitPrice: "150", taxCode: "T1", etaItemCode: "E1", etaCodeType: "GS1"}, {orgId: "o-1", code: "A-2", nameEn: null, nameAr: "دهان", sectionId: "s-2", unit: "sqm", defaultUnitCost: "1000", defaultUnitPrice: "0", taxCode: null, etaItemCode: null, etaCodeType: null}])';
const INSERT_BOARD =
  'insert(table:cost_items).values([{orgId: "o-1", code: "A-1", nameEn: "Board", nameAr: null, sectionId: "s-1", unit: "sqm", defaultUnitCost: "100", defaultUnitPrice: "150", taxCode: "T1", etaItemCode: "E1", etaCodeType: "GS1"}])';
const INSERT_BOARD_SECOND =
  'insert(table:cost_items).values([{orgId: "o-2", code: "A-1", nameEn: "Board", nameAr: null, sectionId: "s-1", unit: "sqm", defaultUnitCost: "100", defaultUnitPrice: "150", taxCode: "T1", etaItemCode: "E1", etaCodeType: "GS1"}])';
const AUDIT_NOTHING_OF_2000 =
  'audit {entity: "cost_item_import", entityId: null, action: "create", before: null, after: {total: 2000, imported: 0, skipped: 2000}}';
const AUDIT_2_OF_2 =
  'audit {entity: "cost_item_import", entityId: null, action: "create", before: null, after: {total: 2, imported: 2, skipped: 0}}';
const AUDIT_1_OF_3 =
  'audit {entity: "cost_item_import", entityId: null, action: "create", before: null, after: {total: 3, imported: 1, skipped: 2}}';
const AUDIT_0_OF_2 =
  'audit {entity: "cost_item_import", entityId: null, action: "create", before: null, after: {total: 2, imported: 0, skipped: 2}}';
const AUDIT_1_OF_1 =
  'audit {entity: "cost_item_import", entityId: null, action: "create", before: null, after: {total: 1, imported: 1, skipped: 0}}';

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const viewer: OrgContext = { ...owner, role: 'viewer' };
const secondAdmin: OrgContext = { orgId: 'o-2', userId: 'u-2', role: 'admin' };

const mapping = {
  code: 0,
  nameEn: 1,
  nameAr: 2,
  category: 3,
  unit: 4,
  cost: 5,
  price: 6,
  taxCode: 7,
  etaItemCode: 8,
  etaCodeType: 9,
};
const sections = [
  { id: 's-1', key: 'civil', nameEn: 'Civil', nameAr: 'مدني' },
  { id: 's-2', key: 'gypsum', nameEn: 'Gypsum', nameAr: 'جبس' },
];
const board = ['A-1', 'Board', '', 'civil', 'sqm', '100', '150', 'T1', 'E1', 'GS1'];
const paint = ['A-2', '', 'دهان', 'جبس', 'sqm', '1,000', '', '', '', ''];
const unknownCategory = ['A-3', 'Tile', '', 'marble', 'sqm', '1', '2', '', '', ''];
const blankRows = (count: number): string[][] => Array.from({ length: count }, () => []);

// What the validator answers for each row, as the summary carries it.
const boardImported = {
  index: 0,
  code: 'A-1',
  ok: true,
  data: {
    code: 'A-1',
    nameEn: 'Board',
    nameAr: null,
    sectionId: 's-1',
    unit: 'sqm',
    defaultUnitCost: '100',
    defaultUnitPrice: '150',
    taxCode: 'T1',
    etaItemCode: 'E1',
    etaCodeType: 'GS1',
  },
};
const paintImported = {
  index: 1,
  code: 'A-2',
  ok: true,
  data: {
    code: 'A-2',
    nameEn: null,
    nameAr: 'دهان',
    sectionId: 's-2',
    unit: 'sqm',
    defaultUnitCost: '1000',
    defaultUnitPrice: '0',
    taxCode: null,
    etaItemCode: null,
    etaCodeType: null,
  },
};

/** A scripted result that makes its statement REJECT, the way the driver refuses a constraint. */
const refusedBy = (code: string, constraint: string) => ({
  then: (_resolve: unknown, reject: (reason: unknown) => void) => reject({ code, constraint_name: constraint }),
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
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => log.mockRestore());
afterAll(() => vi.useRealTimers());

describe('importCostItemsCore, before a transaction opens', () => {
  it('I1 a sheet with no row is import_empty', async () => {
    expect(await importCostItemsCore(owner, { rows: [], mapping })).toEqual({ ok: false, error: 'import_empty' });
    expectTrace([], 0);
  });

  it('I2 one row over the cap is import_too_large', async () => {
    expect(await importCostItemsCore(owner, { rows: blankRows(MAX_IMPORT_ROWS + 1), mapping })).toEqual({
      ok: false,
      error: 'import_too_large',
    });
    expectTrace([], 0);
  });

  it('I4 the shape is answered BEFORE the capability: a viewer with an empty sheet hears import_empty', async () => {
    expect(await importCostItemsCore(viewer, { rows: [], mapping })).toEqual({ ok: false, error: 'import_empty' });
    expectTrace([], 0);
  });

  it('I5 a viewer with a row to import is forbidden, opening nothing', async () => {
    expect(await importCostItemsCore(viewer, { rows: [board], mapping })).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });

  it('I11 a payload whose rows is not an array is not answered with a code: the call rejects', async () => {
    await expect(importCostItemsCore(owner, { rows: undefined as never, mapping })).rejects.toThrow(TypeError);
    expectTrace([], 0);
  });
});

describe('importCostItemsCore, the import', () => {
  it('I3 exactly the cap is admitted; with nothing valid there is no insert, but an audit row and an ok answer', async () => {
    db.respond([], sections);
    expect(await importCostItemsCore(owner, { rows: blankRows(MAX_IMPORT_ROWS), mapping })).toEqual({
      ok: true,
      data: {
        total: 2000,
        imported: 0,
        skipped: 2000,
        results: Array.from({ length: 2000 }, (_, index) => ({ index, code: '', ok: false, error: 'row_empty' })),
      },
    });
    expectTrace([BEGIN, READ_LIVE_CODES, READ_ACTIVE_SECTIONS, AUDIT_NOTHING_OF_2000, 'end'], 0);
  });

  it('I6 two valid rows: the live codes, the active categories, one insert of both, the audit, the summary', async () => {
    db.respond([], sections, []);
    expect(await importCostItemsCore(owner, { rows: [board, paint], mapping })).toEqual({
      ok: true,
      data: { total: 2, imported: 2, skipped: 0, results: [boardImported, paintImported] },
    });
    expectTrace([BEGIN, READ_LIVE_CODES, READ_ACTIVE_SECTIONS, INSERT_BOARD_AND_PAINT, AUDIT_2_OF_2, 'end'], 0);
  });

  it('I7 a code the book already holds and an unknown category are skipped by row; the rest still imports', async () => {
    db.respond([{ code: 'A-2' }], sections, []);
    expect(await importCostItemsCore(owner, { rows: [board, paint, unknownCategory], mapping })).toEqual({
      ok: true,
      data: {
        total: 3,
        imported: 1,
        skipped: 2,
        results: [
          boardImported,
          { index: 1, code: 'A-2', ok: false, error: 'code_exists' },
          { index: 2, code: 'A-3', ok: false, error: 'category_invalid' },
        ],
      },
    });
    expectTrace([BEGIN, READ_LIVE_CODES, READ_ACTIVE_SECTIONS, INSERT_BOARD, AUDIT_1_OF_3, 'end'], 0);
  });

  it('I8 when every row is skipped nothing is inserted, and the answer is still ok with an audit row', async () => {
    db.respond([{ code: 'A-1' }], sections);
    expect(await importCostItemsCore(owner, { rows: [board, unknownCategory], mapping })).toEqual({
      ok: true,
      data: {
        total: 2,
        imported: 0,
        skipped: 2,
        results: [
          { index: 0, code: 'A-1', ok: false, error: 'code_exists' },
          { index: 1, code: 'A-3', ok: false, error: 'category_invalid' },
        ],
      },
    });
    expectTrace([BEGIN, READ_LIVE_CODES, READ_ACTIVE_SECTIONS, AUDIT_0_OF_2, 'end'], 0);
  });

  it('I9 the live codes are compared case-sensitively; another org is carried into the insert', async () => {
    db.respond([{ code: 'a-1' }], sections, []);
    expect(await importCostItemsCore(secondAdmin, { rows: [board], mapping })).toEqual({
      ok: true,
      data: { total: 1, imported: 1, skipped: 0, results: [boardImported] },
    });
    expectTrace([BEGIN_SECOND, READ_LIVE_CODES, READ_ACTIVE_SECTIONS, INSERT_BOARD_SECOND, AUDIT_1_OF_1, 'end'], 0);
  });

  it('I10 an insert the code index refuses names no refusal: generic with one line, no audit', async () => {
    db.respond([], sections, refusedBy('23505', 'cost_items_org_id_code_unique'));
    expect(await importCostItemsCore(owner, { rows: [board, paint], mapping })).toMatchObject({
      ok: false,
      error: 'generic',
    });
    expectTrace([BEGIN, READ_LIVE_CODES, READ_ACTIVE_SECTIONS, INSERT_BOARD_AND_PAINT, 'end'], 1);
    expect(log.mock.calls[0]?.[0]).toBe('mutateInOrg failed');
  });
});
