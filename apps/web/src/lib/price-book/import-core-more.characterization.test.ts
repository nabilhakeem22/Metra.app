// MORE CHARACTERIZATION of importCostItemsCore, beside the file committed before
// the split (which is not edited): the column mapping, with a SECOND value. The
// first file reads every sheet through one mapping, so a core that hard-coded
// it passed; here the columns are in another order and the optional ones are
// absent.
// Same recording double and conventions. Every scenario is green on the unsplit
// code and on the split code alike.
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

const { importCostItemsCore } = await import('./import-core');

// The statements, exactly as the unsplit core issues them.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const READ_LIVE_CODES = 'select({code: cost_items.code}).from(table:cost_items)';
const READ_ACTIVE_SECTIONS =
  'select({id: sections.id, key: sections.key, nameEn: sections.name_en, nameAr: sections.name_ar}).from(table:sections).where(sql("sections"."active" = $1 [true]))';
const INSERT_PLASTER =
  'insert(table:cost_items).values([{orgId: "o-1", code: "B-7", nameEn: null, nameAr: "بياض", sectionId: "s-2", unit: "sqm", defaultUnitCost: "60", defaultUnitPrice: "80", taxCode: null, etaItemCode: null, etaCodeType: null}])';
const AUDIT_1_OF_1 =
  'audit {entity: "cost_item_import", entityId: null, action: "create", before: null, after: {total: 1, imported: 1, skipped: 0}}';

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };

// A sheet laid out differently from the first file's: the Arabic name first, the
// price before the cost, and no English name, tax or ETA column at all.
const narrowMapping = { nameAr: 0, category: 1, code: 2, unit: 3, price: 4, cost: 5 };
const plaster = ['بياض', 'جبس', 'B-7', 'sqm', '80', '60'];
const sections = [
  { id: 's-1', key: 'civil', nameEn: 'Civil', nameAr: 'مدني' },
  { id: 's-2', key: 'gypsum', nameEn: 'Gypsum', nameAr: 'جبس' },
];
const plasterImported = {
  index: 0,
  code: 'B-7',
  ok: true,
  data: {
    code: 'B-7',
    nameEn: null,
    nameAr: 'بياض',
    sectionId: 's-2',
    unit: 'sqm',
    defaultUnitCost: '60',
    defaultUnitPrice: '80',
    taxCode: null,
    etaItemCode: null,
    etaCodeType: null,
  },
};

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

describe('importCostItemsCore, a second column mapping', () => {
  it('I12 each cell is read from the column THIS mapping names, and a column it does not name is null', async () => {
    db.respond([], sections, []);
    expect(await importCostItemsCore(owner, { rows: [plaster], mapping: narrowMapping })).toEqual({
      ok: true,
      data: { total: 1, imported: 1, skipped: 0, results: [plasterImported] },
    });
    expectTrace([BEGIN, READ_LIVE_CODES, READ_ACTIVE_SECTIONS, INSERT_PLASTER, AUDIT_1_OF_1, 'end'], 0);
  });
});
