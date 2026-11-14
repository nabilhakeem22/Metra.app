// CHARACTERIZATION of bulkUpdatePricesCore: what it answers and, statement by
// statement, what it asks the database on every branch. Written against the code
// as it stood BEFORE it was split into named phases, and not edited since: a
// refactor that changes a statement, its parameters, the order, an early return,
// a thrown code or the audit row fails here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; bulkPercentError and applyBulkPercent run for real. The update is
// the one statement here whose SQL spans lines, so its journal entry is a
// multi-line string, pasted below as a template literal and compared whole: no
// whitespace is collapsed. What a real Postgres adds (the arithmetic in numeric,
// RLS, the append-only grants on the history) is proven in
// tests/actions/bulkUpdate.dbtest.ts.
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

const { bulkUpdatePricesCore } = await import('./bulk-core');

const SECTION = '77777777-7777-4777-8777-777777777777';

// The statements, exactly as the unsplit core issued them.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const BEGIN_SECOND = 'begin [{orgId: "o-2", userId: "u-2", role: "admin"}, {write: true, capTransaction: undefined}]';
const READ_SECTION =
  'select({key: sections.key, nameEn: sections.name_en, nameAr: sections.name_ar}).from(table:sections).where(sql("sections"."id" = $1 ["77777777-7777-4777-8777-777777777777"])).limit(1)';
const UPDATE_BOTH_BY_15 = `execute(sql(
    update public.cost_items c
    set
      default_unit_cost = round(c.default_unit_cost * (1 + $1::numeric / 100), 4),
      default_unit_price = round(c.default_unit_price * (1 + $2::numeric / 100), 4),
      updated_at = now()
    from (
      select id, default_unit_cost as old_cost, default_unit_price as old_price
      from public.cost_items
      where section_id = $3
    ) old
    where c.id = old.id
    returning
      c.id as id,
      old.old_cost as old_cost,
      old.old_price as old_price,
      c.default_unit_cost as new_cost,
      c.default_unit_price as new_price
   ["15","15","77777777-7777-4777-8777-777777777777"]))`;
const UPDATE_COST_BY_MINUS_10 = `execute(sql(
    update public.cost_items c
    set
      default_unit_cost = round(c.default_unit_cost * (1 + $1::numeric / 100), 4),
      default_unit_price = c.default_unit_price,
      updated_at = now()
    from (
      select id, default_unit_cost as old_cost, default_unit_price as old_price
      from public.cost_items
      where section_id = $2
    ) old
    where c.id = old.id
    returning
      c.id as id,
      old.old_cost as old_cost,
      old.old_price as old_price,
      c.default_unit_cost as new_cost,
      c.default_unit_price as new_price
   ["-10","77777777-7777-4777-8777-777777777777"]))`;
const UPDATE_PRICE_BY_12_5 = `execute(sql(
    update public.cost_items c
    set
      default_unit_cost = c.default_unit_cost,
      default_unit_price = round(c.default_unit_price * (1 + $1::numeric / 100), 4),
      updated_at = now()
    from (
      select id, default_unit_cost as old_cost, default_unit_price as old_price
      from public.cost_items
      where section_id = $2
    ) old
    where c.id = old.id
    returning
      c.id as id,
      old.old_cost as old_cost,
      old.old_price as old_price,
      c.default_unit_cost as new_cost,
      c.default_unit_price as new_price
   ["12.5","77777777-7777-4777-8777-777777777777"]))`;

const INSERT_HEADER_BOTH =
  'insert(table:price_changes).values({orgId: "o-1", category: "civil", pctChange: "15", target: "both", effectiveDate: "2026-11-14", appliedBy: "u-1", itemCount: 2}).returning({id: price_changes.id})';
const INSERT_HEADER_COST =
  'insert(table:price_changes).values({orgId: "o-1", category: "civil", pctChange: "-10", target: "cost", effectiveDate: "2026-11-14", appliedBy: "u-1", itemCount: 2}).returning({id: price_changes.id})';
const INSERT_HEADER_PRICE_SECOND =
  'insert(table:price_changes).values({orgId: "o-2", category: "civil", pctChange: "12.5", target: "price", effectiveDate: "2026-11-14", appliedBy: "u-2", itemCount: 2}).returning({id: price_changes.id})';
const INSERT_LINES =
  'insert(table:price_change_lines).values([{orgId: "o-1", priceChangeId: "chg-1", costItemId: "ci-1", oldUnitCost: "100.0000", newUnitCost: "115.0000", oldUnitPrice: "150.0000", newUnitPrice: "172.5000"}, {orgId: "o-1", priceChangeId: "chg-1", costItemId: "ci-2", oldUnitCost: "20.5000", newUnitCost: "23.5750", oldUnitPrice: "31.2500", newUnitPrice: "35.9375"}])';
const INSERT_LINES_SECOND =
  'insert(table:price_change_lines).values([{orgId: "o-2", priceChangeId: "chg-1", costItemId: "ci-1", oldUnitCost: "100.0000", newUnitCost: "115.0000", oldUnitPrice: "150.0000", newUnitPrice: "172.5000"}, {orgId: "o-2", priceChangeId: "chg-1", costItemId: "ci-2", oldUnitCost: "20.5000", newUnitCost: "23.5750", oldUnitPrice: "31.2500", newUnitPrice: "35.9375"}])';
const AUDIT_BOTH =
  'audit {entity: "price_change", entityId: "chg-1", action: "create", before: null, after: {section_id: "77777777-7777-4777-8777-777777777777", category: "civil", pct_change: "15", target: "both", item_count: 2}}';
const AUDIT_COST =
  'audit {entity: "price_change", entityId: "chg-1", action: "create", before: null, after: {section_id: "77777777-7777-4777-8777-777777777777", category: "civil", pct_change: "-10", target: "cost", item_count: 2}}';
const AUDIT_PRICE =
  'audit {entity: "price_change", entityId: "chg-1", action: "create", before: null, after: {section_id: "77777777-7777-4777-8777-777777777777", category: "civil", pct_change: "12.5", target: "price", item_count: 2}}';

// A change that touched no item: the header alone, counted zero.
const INSERT_EMPTY_HEADER =
  'insert(table:price_changes).values({orgId: "o-1", category: "civil", pctChange: "15", target: "both", effectiveDate: "2026-11-14", appliedBy: "u-1", itemCount: 0}).returning({id: price_changes.id})';
const AUDIT_EMPTY =
  'audit {entity: "price_change", entityId: "chg-1", action: "create", before: null, after: {section_id: "77777777-7777-4777-8777-777777777777", category: "civil", pct_change: "15", target: "both", item_count: 0}}';
const INSERT_EMPTY_HEADER_ENGLISH_NAME =
  'insert(table:price_changes).values({orgId: "o-1", category: "Civil", pctChange: "15", target: "both", effectiveDate: "2026-11-14", appliedBy: "u-1", itemCount: 0}).returning({id: price_changes.id})';
const AUDIT_EMPTY_ENGLISH_NAME =
  'audit {entity: "price_change", entityId: "chg-1", action: "create", before: null, after: {section_id: "77777777-7777-4777-8777-777777777777", category: "Civil", pct_change: "15", target: "both", item_count: 0}}';
const INSERT_EMPTY_HEADER_ARABIC_NAME =
  'insert(table:price_changes).values({orgId: "o-1", category: "مدني", pctChange: "15", target: "both", effectiveDate: "2026-11-14", appliedBy: "u-1", itemCount: 0}).returning({id: price_changes.id})';
const AUDIT_EMPTY_ARABIC_NAME =
  'audit {entity: "price_change", entityId: "chg-1", action: "create", before: null, after: {section_id: "77777777-7777-4777-8777-777777777777", category: "مدني", pct_change: "15", target: "both", item_count: 0}}';
const INSERT_EMPTY_HEADER_SECTION_ID =
  'insert(table:price_changes).values({orgId: "o-1", category: "77777777-7777-4777-8777-777777777777", pctChange: "15", target: "both", effectiveDate: "2026-11-14", appliedBy: "u-1", itemCount: 0}).returning({id: price_changes.id})';
const AUDIT_EMPTY_SECTION_ID =
  'audit {entity: "price_change", entityId: "chg-1", action: "create", before: null, after: {section_id: "77777777-7777-4777-8777-777777777777", category: "77777777-7777-4777-8777-777777777777", pct_change: "15", target: "both", item_count: 0}}';
const INSERT_EMPTY_HEADER_DATED_DECEMBER =
  'insert(table:price_changes).values({orgId: "o-1", category: "civil", pctChange: "15", target: "both", effectiveDate: "2026-12-01", appliedBy: "u-1", itemCount: 0}).returning({id: price_changes.id})';
const INSERT_EMPTY_HEADER_DATED_FEBRUARY_31 =
  'insert(table:price_changes).values({orgId: "o-1", category: "civil", pctChange: "15", target: "both", effectiveDate: "2026-02-31", appliedBy: "u-1", itemCount: 0}).returning({id: price_changes.id})';
const INSERT_EMPTY_HEADER_NEXT_YEAR =
  'insert(table:price_changes).values({orgId: "o-1", category: "civil", pctChange: "15", target: "both", effectiveDate: "2027-01-05", appliedBy: "u-1", itemCount: 0}).returning({id: price_changes.id})';

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const manager: OrgContext = { ...owner, role: 'project_manager' };
const secondAdmin: OrgContext = { orgId: 'o-2', userId: 'u-2', role: 'admin' };

const base = { sectionId: SECTION, pct: '15', target: 'both' as const };
const section = (key: string | null, nameEn: string | null, nameAr: string | null) => [{ key, nameEn, nameAr }];
const civil = section('civil', 'Civil', 'مدني');
// Eight figures, all different, so a swapped column shows.
const two = [
  { id: 'ci-1', old_cost: '100.0000', old_price: '150.0000', new_cost: '115.0000', new_price: '172.5000' },
  { id: 'ci-2', old_cost: '20.5000', old_price: '31.2500', new_cost: '23.5750', new_price: '35.9375' },
];
const header = [{ id: 'chg-1' }];
const nothingTouched = { ok: true, data: { changeId: 'chg-1', itemCount: 0 } };

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

describe('bulkUpdatePricesCore, before a transaction opens', () => {
  it('B1 a percentage that is not a plain decimal is refused under pct', async () => {
    expect(await bulkUpdatePricesCore(owner, { ...base, pct: '1e2' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { pct: { code: 'not_a_number' } },
    });
    expectTrace([], 0);
  });

  it('B2 a percentage outside the range is refused under pct with its bounds', async () => {
    expect(await bulkUpdatePricesCore(owner, { ...base, pct: '2000' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { pct: { code: 'out_of_range', params: { min: -100, max: 1000 } } },
    });
    expectTrace([], 0);
  });

  it('B3 a target that is none of the three is malformed', async () => {
    expect(await bulkUpdatePricesCore(owner, { ...base, target: 'all' as never })).toEqual({
      ok: false,
      error: 'malformed',
    });
    expectTrace([], 0);
  });

  it('B4 a section id that is no id is malformed', async () => {
    expect(await bulkUpdatePricesCore(owner, { ...base, sectionId: 'x' })).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('B5 the percentage is checked FIRST: with all three wrong, the answer is about the percentage', async () => {
    expect(await bulkUpdatePricesCore(owner, { sectionId: 'x', pct: '', target: 'all' as never })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { pct: { code: 'required' } },
    });
    expectTrace([], 0);
  });

  it('B6 the shape is checked BEFORE the capability: a project manager with a bad percentage hears about it', async () => {
    expect(await bulkUpdatePricesCore(manager, { ...base, pct: 'abc' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { pct: { code: 'not_a_number' } },
    });
    expectTrace([], 0);
  });

  it('B7 a project manager with a valid change is forbidden, opening nothing', async () => {
    expect(await bulkUpdatePricesCore(manager, base)).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });
});

describe('bulkUpdatePricesCore, the category', () => {
  it('B8 a category deleted meanwhile is refused under sectionId, nothing updated', async () => {
    db.respond([]);
    expect(await bulkUpdatePricesCore(owner, base)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { sectionId: { code: 'no_longer_exists' } },
    });
    expectTrace([BEGIN, READ_SECTION, 'end'], 0);
  });

  it('B13 with no key the history freezes the English name', async () => {
    db.respond(section(null, 'Civil', 'مدني'), [], header);
    expect(await bulkUpdatePricesCore(owner, base)).toEqual(nothingTouched);
    expectTrace(
      [BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_EMPTY_HEADER_ENGLISH_NAME, AUDIT_EMPTY_ENGLISH_NAME, 'end'],
      0,
    );
  });

  it('B14 with no key and no English name it freezes the Arabic name', async () => {
    db.respond(section(null, null, 'مدني'), [], header);
    expect(await bulkUpdatePricesCore(owner, base)).toEqual(nothingTouched);
    expectTrace(
      [BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_EMPTY_HEADER_ARABIC_NAME, AUDIT_EMPTY_ARABIC_NAME, 'end'],
      0,
    );
  });

  it('B15 with no key and no name it freezes the section id', async () => {
    db.respond(section(null, null, null), [], header);
    expect(await bulkUpdatePricesCore(owner, base)).toEqual(nothingTouched);
    expectTrace(
      [BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_EMPTY_HEADER_SECTION_ID, AUDIT_EMPTY_SECTION_ID, 'end'],
      0,
    );
  });
});

describe('bulkUpdatePricesCore, the update and its history', () => {
  it('B9 both columns: the update, the header, one line per touched item, the audit, the summary', async () => {
    db.respond(civil, two, header, []);
    expect(await bulkUpdatePricesCore(owner, base)).toEqual({ ok: true, data: { changeId: 'chg-1', itemCount: 2 } });
    expectTrace([BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_HEADER_BOTH, INSERT_LINES, AUDIT_BOTH, 'end'], 0);
  });

  it('B10 the cost only, by a negative percentage: one bound percentage, and the history says cost', async () => {
    db.respond(civil, two, header, []);
    expect(await bulkUpdatePricesCore(owner, { ...base, target: 'cost', pct: '-10' })).toEqual({
      ok: true,
      data: { changeId: 'chg-1', itemCount: 2 },
    });
    expectTrace([BEGIN, READ_SECTION, UPDATE_COST_BY_MINUS_10, INSERT_HEADER_COST, INSERT_LINES, AUDIT_COST, 'end'], 0);
  });

  it('B11 the price only, in another org by another user: both are carried into the history', async () => {
    db.respond(civil, two, header, []);
    expect(await bulkUpdatePricesCore(secondAdmin, { ...base, target: 'price', pct: '12.5' })).toEqual({
      ok: true,
      data: { changeId: 'chg-1', itemCount: 2 },
    });
    expectTrace(
      [
        BEGIN_SECOND,
        READ_SECTION,
        UPDATE_PRICE_BY_12_5,
        INSERT_HEADER_PRICE_SECOND,
        INSERT_LINES_SECOND,
        AUDIT_PRICE,
        'end',
      ],
      0,
    );
  });

  it('B12 a category with no item still leaves a header counted zero, and no line insert', async () => {
    db.respond(civil, [], header);
    expect(await bulkUpdatePricesCore(owner, base)).toEqual(nothingTouched);
    expectTrace([BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_EMPTY_HEADER, AUDIT_EMPTY, 'end'], 0);
  });

  it('B21 a header the database refuses is generic with one line: no line insert, no audit', async () => {
    db.respond(civil, two, rejectedWith({ code: '22008' }));
    expect(await bulkUpdatePricesCore(owner, base)).toMatchObject({ ok: false, error: 'generic' });
    expectTrace([BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_HEADER_BOTH, 'end'], 1);
    expect(log.mock.calls[0]?.[0]).toBe('mutateInOrg failed');
  });
});

describe('bulkUpdatePricesCore, the effective date', () => {
  it('B16 a date in the YYYY-MM-DD shape is kept', async () => {
    db.respond(civil, [], header);
    expect(await bulkUpdatePricesCore(owner, { ...base, effectiveDate: '2026-12-01' })).toEqual(nothingTouched);
    expectTrace([BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_EMPTY_HEADER_DATED_DECEMBER, AUDIT_EMPTY, 'end'], 0);
  });

  it('B17 a value that is no date is not refused: it becomes today', async () => {
    db.respond(civil, [], header);
    expect(await bulkUpdatePricesCore(owner, { ...base, effectiveDate: 'next week' })).toEqual(nothingTouched);
    expectTrace([BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_EMPTY_HEADER, AUDIT_EMPTY, 'end'], 0);
  });

  it('B18 an empty date becomes today', async () => {
    db.respond(civil, [], header);
    expect(await bulkUpdatePricesCore(owner, { ...base, effectiveDate: '' })).toEqual(nothingTouched);
    expectTrace([BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_EMPTY_HEADER, AUDIT_EMPTY, 'end'], 0);
  });

  it('B19 only the shape is checked: a day that does not exist goes to the insert as typed', async () => {
    db.respond(civil, [], header);
    expect(await bulkUpdatePricesCore(owner, { ...base, effectiveDate: '2026-02-31' })).toEqual(nothingTouched);
    expectTrace([BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_EMPTY_HEADER_DATED_FEBRUARY_31, AUDIT_EMPTY, 'end'], 0);
  });

  it('B20 with no date sent, today is read from the clock, in UTC', async () => {
    vi.setSystemTime(new Date('2027-01-05T10:00:00.000Z'));
    try {
      db.respond(civil, [], header);
      expect(await bulkUpdatePricesCore(owner, base)).toEqual(nothingTouched);
    } finally {
      vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
    }
    expectTrace([BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_EMPTY_HEADER_NEXT_YEAR, AUDIT_EMPTY, 'end'], 0);
  });
});
