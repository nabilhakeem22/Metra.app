import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { computeFinalAccount, finalAccountBalance, type MeasuredLine } from '@/lib/execution/money/final-account';
import { loadMeasuredWorks } from '@/lib/execution/queries/measured-works';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedVariation } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// A3 reliability R3: the delivery card reads the measured works as ONE SQL
// figure (lib/execution/queries/measured-works.ts) instead of loading every
// measured line into computeFinalAccount. The figure must be the one
// computeFinalAccount would reach over the same lines, to the piastre: 4-decimal
// quantities, prices and line discounts, several readings (the latest recorded
// one wins), approved change-order quantity on a line, a residual below zero, a
// residual of exactly zero, and firm lines (flagged, never billed).

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

type LineRow = { id: string; n: number; qty: string; unit_price: string; discount_pct: string; provisional: boolean };

async function measure(contractId: string, lineId: string, qty: string): Promise<void> {
  await ownerQuery(
    `insert into public.contract_line_measurements (org_id, contract_id, contract_line_id, measured_qty, measured_on, recorded_by)
     values ($1, $2, $3, $4, current_date, $5)`,
    [orgId, contractId, lineId, qty, owner.userId],
  );
}

/** What the card USED to load and what the final account page computes from: the per-line rows. */
async function measuredLines(contractId: string): Promise<MeasuredLine[]> {
  const rows = await ownerQuery<{ id: string; qty: string; unit_price: string; discount_pct: string; provisional: boolean; measured: string; ordered: string }>(
    `select l.id, l.qty::text, l.unit_price::text, l.discount_pct::text, l.provisional,
            (select m.measured_qty::text from public.contract_line_measurements m
              where m.contract_line_id = l.id order by m.seq desc limit 1) as measured,
            coalesce((select sum(vl.qty) from public.variation_order_lines vl
                        join public.variation_orders v on v.id = vl.variation_order_id
                       where vl.contract_line_id = l.id and v.status = 'approved'), 0)::text as ordered
       from public.contract_lines l
      where l.contract_id = $1
        and exists (select 1 from public.contract_line_measurements m where m.contract_line_id = l.id)`,
    [contractId],
  );
  return rows.map((row) => ({
    lineId: row.id,
    qty: row.qty,
    unitPrice: row.unit_price,
    discountPct: row.discount_pct,
    provisional: row.provisional,
    measuredQty: row.measured,
    variationQty: row.ordered,
  }));
}

describe('the measured works, summed in SQL (R3)', () => {
  it('equal computeFinalAccount over the same lines, to the piastre, and give the same balance', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [40], state: 'draft' });
    const id = contract.contractId;
    // Awkward figures on every line while the contract is a draft (the child guard allows it).
    await ownerQuery(
      `update public.contract_lines
          set qty = sort_order + 0.3333, unit_price = 87.5555 + sort_order * 0.0007,
              discount_pct = case when sort_order % 3 = 0 then 12.5 when sort_order % 3 = 1 then 7.3333 else 0 end
        where contract_id = $1`,
      [id],
    );
    await ownerQuery(`update public.contracts set discount_pct = 2.5 where id = $1`, [id]);
    const lines = await ownerQuery<LineRow>(
      `select id, sort_order as n, qty::text, unit_price::text, discount_pct::text, provisional
         from public.contract_lines where contract_id = $1 order by sort_order`,
      [id],
    );
    const provisional = lines.filter((line) => line.provisional);
    const firm = lines.filter((line) => !line.provisional);
    expect(provisional.length).toBeGreaterThanOrEqual(6);

    // An approved change order adding 1.1111 on two provisional lines.
    const variation = await seedVariation(orgId, contract, 'draft', { netDelta: '500' });
    for (const line of provisional.slice(0, 2)) {
      await ownerQuery(
        `insert into public.variation_order_lines (org_id, variation_order_id, contract_line_id, description_en, qty, unit, unit_price)
         values ($1, $2, $3, 'More of the line', 1.1111, 'sqm', $4)`,
        [orgId, variation.id, line.id, line.unit_price],
      );
    }
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [id]);
    await ownerQuery(`update public.contracts set status = 'signed' where id = $1`, [id]);
    for (const next of ['internal_approved', 'issued', 'approved']) {
      await ownerQuery(`update public.variation_orders set status = $2 where id = $1`, [variation.id, next]);
    }

    // Readings: an earlier one that the latest replaces, over and under the quantity,
    // one landing exactly on quantity + change order (residual 0), and firm lines.
    for (const [index, line] of provisional.entries()) {
      await measure(id, line.id, formatMoney4(parseMoney4(line.qty) + parseMoney4('50')));
      const shift = ['3.7777', '-2.4444', '0.0001', '11.1119', '-0.5', '6.6667'][index % 6];
      const latest = index === 1 ? parseMoney4(line.qty) + parseMoney4('1.1111') : parseMoney4(line.qty) + parseMoney4(shift);
      await measure(id, line.id, formatMoney4(latest));
    }
    for (const line of firm.slice(0, 3)) await measure(id, line.id, formatMoney4(parseMoney4(line.qty) + parseMoney4('2')));

    const perLine = await measuredLines(id);
    const charges = { originalValue: '124000', taxRate: '14', supervisionPct: '10', discountPct: '2.5', approvedVariationNetDeltas: ['500'], issuedRequestsTotal: '62000' };
    const account = computeFinalAccount({ ...charges, measuredLines: perLine });
    expect(account.billedLines.length).toBe(provisional.length - 1);
    expect(account.flaggedLines.length).toBe(3);
    const expectedWorks = formatMoney4(account.billedLines.reduce((total, line) => total + parseMoney4(line.works), 0n));

    const works = await withOrgContext(owner, (tx) => loadMeasuredWorks(tx, id));
    expect(formatMoney4(parseMoney4(works))).toBe(expectedWorks);
    expect(finalAccountBalance(charges, works)).toBe(account.balance);
  });

  it('is 0 with no measurement, and for another studio reads nothing (row-level security)', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [5], state: 'signed' });
    expect(await withOrgContext(owner, (tx) => loadMeasuredWorks(tx, contract.contractId))).toBe('0');
    const [line] = await ownerQuery<{ id: string; qty: string }>(
      `select id, qty::text from public.contract_lines where contract_id = $1 and provisional limit 1`,
      [contract.contractId],
    );
    await measure(contract.contractId, line.id, formatMoney4(parseMoney4(line.qty) + parseMoney4('10')));
    expect(await withOrgContext(owner, (tx) => loadMeasuredWorks(tx, contract.contractId))).toBe('1000.0000');
    const stranger = await seedOrg({ owners: 1 });
    orgIds.push(stranger.orgId);
    const theirs = ctxFor(stranger.orgId, stranger.ownerIds[0], 'owner');
    expect(await withOrgContext(theirs, (tx) => loadMeasuredWorks(tx, contract.contractId))).toBe('0');
  });
});
