// MORE CHARACTERIZATION of bulkUpdatePricesCore, beside the file committed before
// the split (which is not edited): every value the core passes through, with a
// SECOND value. The first file changes one category and has the history header
// answer one id, so a statement that hard-coded either passed it; here the
// category and the header's id are both different. And the audit row: awaited,
// and answered as the unsplit code answers when the database refuses it.
// Same recording double and conventions, with one difference in the audit double
// (below). Every scenario is green on the unsplit code and on the split code
// alike.
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

const { bulkUpdatePricesCore } = await import('./bulk-core');

// Not the category the first file uses.
const SECOND_SECTION = '88888888-8888-4888-8888-888888888888';

// The statements, exactly as the unsplit core issues them for the second
// category and a header that answers the id chg-2.
const BEGIN = 'begin [{orgId: "o-1", userId: "u-1", role: "owner"}, {write: true, capTransaction: undefined}]';
const READ_SECTION =
  'select({key: sections.key, nameEn: sections.name_en, nameAr: sections.name_ar}).from(table:sections).where(sql("sections"."id" = $1 ["88888888-8888-4888-8888-888888888888"])).limit(1)';
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
   ["15","15","88888888-8888-4888-8888-888888888888"]))`;
const INSERT_HEADER_NAMED_BY_ITS_ID =
  'insert(table:price_changes).values({orgId: "o-1", category: "88888888-8888-4888-8888-888888888888", pctChange: "15", target: "both", effectiveDate: "2026-11-14", appliedBy: "u-1", itemCount: 2}).returning({id: price_changes.id})';
const INSERT_LINES =
  'insert(table:price_change_lines).values([{orgId: "o-1", priceChangeId: "chg-2", costItemId: "ci-1", oldUnitCost: "100.0000", newUnitCost: "115.0000", oldUnitPrice: "150.0000", newUnitPrice: "172.5000"}, {orgId: "o-1", priceChangeId: "chg-2", costItemId: "ci-2", oldUnitCost: "20.5000", newUnitCost: "23.5750", oldUnitPrice: "31.2500", newUnitPrice: "35.9375"}])';
const AUDIT_NAMED_BY_ITS_ID =
  'audit {entity: "price_change", entityId: "chg-2", action: "create", before: null, after: {section_id: "88888888-8888-4888-8888-888888888888", category: "88888888-8888-4888-8888-888888888888", pct_change: "15", target: "both", item_count: 2}}';
const AUDIT_REFUSED =
  'audit refused {entity: "price_change", entityId: "chg-2", action: "create", before: null, after: {section_id: "88888888-8888-4888-8888-888888888888", category: "88888888-8888-4888-8888-888888888888", pct_change: "15", target: "both", item_count: 2}}';

// A change that touched exactly one item.
const INSERT_HEADER_OF_ONE =
  'insert(table:price_changes).values({orgId: "o-1", category: "88888888-8888-4888-8888-888888888888", pctChange: "15", target: "both", effectiveDate: "2026-11-14", appliedBy: "u-1", itemCount: 1}).returning({id: price_changes.id})';
const INSERT_ONE_LINE =
  'insert(table:price_change_lines).values([{orgId: "o-1", priceChangeId: "chg-2", costItemId: "ci-1", oldUnitCost: "100.0000", newUnitCost: "115.0000", oldUnitPrice: "150.0000", newUnitPrice: "172.5000"}])';
const AUDIT_OF_ONE =
  'audit {entity: "price_change", entityId: "chg-2", action: "create", before: null, after: {section_id: "88888888-8888-4888-8888-888888888888", category: "88888888-8888-4888-8888-888888888888", pct_change: "15", target: "both", item_count: 1}}';

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };

const change = { sectionId: SECOND_SECTION, pct: '15', target: 'both' as const };
const section = (key: string | null, nameEn: string | null, nameAr: string | null) => [{ key, nameEn, nameAr }];
const two = [
  { id: 'ci-1', old_cost: '100.0000', old_price: '150.0000', new_cost: '115.0000', new_price: '172.5000' },
  { id: 'ci-2', old_cost: '20.5000', old_price: '31.2500', new_cost: '23.5750', new_price: '35.9375' },
];
const header = [{ id: 'chg-2' }];

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

describe('bulkUpdatePricesCore, a second category and a second header', () => {
  it('B22 the category that was sent is the one read, updated, frozen as its own label and audited; the id the header answered is the one the lines, the audit and the summary carry', async () => {
    // No key and no name, so the label the history freezes is the category id itself.
    db.respond(section(null, null, null), two, header, []);
    expect(await settled(bulkUpdatePricesCore(owner, change))).toEqual({
      ok: true,
      data: { changeId: 'chg-2', itemCount: 2 },
    });
    expectTrace(
      [BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_HEADER_NAMED_BY_ITS_ID, INSERT_LINES, AUDIT_NAMED_BY_ITS_ID, 'end'],
      0,
    );
  });
});

describe('bulkUpdatePricesCore, the smallest change that touches anything', () => {
  it('B24 a category with ONE item leaves a header counted one and a line insert of that one item', async () => {
    db.respond(section(null, null, null), [two[0]], header, []);
    expect(await settled(bulkUpdatePricesCore(owner, change))).toEqual({
      ok: true,
      data: { changeId: 'chg-2', itemCount: 1 },
    });
    expectTrace([BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_HEADER_OF_ONE, INSERT_ONE_LINE, AUDIT_OF_ONE, 'end'], 0);
  });
});

describe('bulkUpdatePricesCore, an audit row the database refuses', () => {
  it('B23 the refusal is the answer: generic with one line, inside the transaction, and no rejection escapes', async () => {
    auditInsert.refusal = { code: '42501' };
    db.respond(section(null, null, null), two, header, []);
    expect(await settled(bulkUpdatePricesCore(owner, change))).toEqual(GENERIC);
    expectTrace(
      [BEGIN, READ_SECTION, UPDATE_BOTH_BY_15, INSERT_HEADER_NAMED_BY_ITS_ID, INSERT_LINES, AUDIT_REFUSED, 'end'],
      1,
    );
    expect(log.mock.calls[0]?.[0]).toBe('mutateInOrg failed');
  });
});
