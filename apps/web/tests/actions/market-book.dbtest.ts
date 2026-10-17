import { sqlstateOf } from '@metra/db/sqlstate';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { asAppRole, closeMarketFixture, marketRaw, seedBulletin, seedDetails, seedMarketItem, withdrawBulletin } from './market-fixture';

// The market price book at the database (plan AC 1 to 5): platform-level tables
// that every member org reads, nobody writes through the app, and that hide a
// withdrawn bulletin's figures. Periods sit in 2001/2002 so no real bulletin
// can collide with the one-published-per-period index.

const TABLES = ['market_categories', 'market_items', 'market_bulletins', 'market_price_observations', 'market_item_details'];
const orgIds: string[] = [];
let ctx: OrgContext;
let item: { id: string; key: string };

beforeAll(async () => {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  ctx = ctxFor(orgId, ownerIds[0], 'owner');
  item = await seedMarketItem();
  await seedDetails(item.id, await seedBulletin('2002-03', [[item.id, '2002-03', '400']]));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeMarketFixture();
  await closeFixture();
});

async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return sqlstateOf(error) ?? 'unknown';
  }
}

const countIn = (table: string) =>
  withOrgContext(ctx, async (tx) => {
    const rows = await tx.execute(sql.raw(`select count(*)::int as n from public.${table}`));
    return Number((rows as unknown as Array<{ n: number }>)[0].n);
  });

describe('market tables as metra_app (AC 1, 2)', () => {
  it.each(TABLES)('a member org context reads %s', async (table) => {
    expect(await countIn(table)).toBeGreaterThan(0);
  });

  it.each(TABLES)('refuses insert, update and delete on %s with 42501', async (table) => {
    const write = (statement: string) => refusal(() => withOrgContext(ctx, (tx) => tx.execute(sql.raw(statement))));
    expect(await write(`insert into public.${table} (id) values (gen_random_uuid())`)).toBe('42501');
    expect(await write(`update public.${table} set id = id`)).toBe('42501');
    expect(await write(`delete from public.${table}`)).toBe('42501');
  });

  it.each(TABLES)('returns no %s row outside an org context, or in a forged one', async (table) => {
    const query = `select count(*)::int as n from public.${table}`;
    expect(await asAppRole<{ n: number }>({}, query)).toEqual([{ n: 0 }]);
    const forged = { 'app.current_org_id': ctx.orgId, 'app.current_user_id': randomUUID() };
    expect(await asAppRole<{ n: number }>(forged, query)).toEqual([{ n: 0 }]);
  });
});

describe('withdrawn bulletins and the effective price (AC 3, 4)', () => {
  const EFFECTIVE = (itemId: string) => sql`
    select distinct on (o.item_id, o.period_month) o.price, b.period_month as bulletin_month
      from public.market_price_observations o
      join public.market_bulletins b on b.id = o.bulletin_id and b.status = 'published'
     where o.item_id = ${itemId} and o.period_month = '2001-06-01'
     order by o.item_id, o.period_month, b.period_month desc`;

  it('takes the newest published bulletin, and falls back when it is withdrawn', async () => {
    const june = await seedMarketItem();
    await seedBulletin('2001-07', [[june.id, '2001-06', '100']]);
    const august = await seedBulletin('2001-08', [[june.id, '2001-06', '110']]);
    const effective = () => withOrgContext(ctx, (tx) => tx.execute(EFFECTIVE(june.id)));
    expect(await effective()).toEqual([{ price: '110.0000', bulletin_month: '2001-08-01' }]);
    await withdrawBulletin(august);
    expect(await effective()).toEqual([{ price: '100.0000', bulletin_month: '2001-07-01' }]);
  });

  it('hides an item whose only prices are in a withdrawn bulletin, and its details (S3)', async () => {
    const orphan = await seedMarketItem();
    const bulletin = await seedBulletin('2001-10', [[orphan.id, '2001-10', '75']]);
    await seedDetails(orphan.id, bulletin);
    const visible = () => withOrgContext(ctx, async (tx) => ({
      items: (await tx.execute(sql`select id from public.market_items where id = ${orphan.id}`)).length,
      details: (await tx.execute(sql`select id from public.market_item_details where item_id = ${orphan.id}`)).length,
    }));
    expect(await visible()).toEqual({ items: 1, details: 1 });
    await withdrawBulletin(bulletin);
    expect(await visible()).toEqual({ items: 0, details: 0 });
  });

  it('hides a withdrawn bulletin and its observations even without the join', async () => {
    const hidden = await seedMarketItem();
    const bulletin = await seedBulletin('2001-11', [[hidden.id, '2001-11', '90']]);
    await withdrawBulletin(bulletin);
    const visible = await withOrgContext(ctx, async (tx) => ({
      bulletins: await tx.execute(sql`select id from public.market_bulletins where id = ${bulletin}`),
      observations: await tx.execute(sql`select id from public.market_price_observations where bulletin_id = ${bulletin}`),
      withdrawn: await tx.execute(sql`select id from public.market_bulletins where status = 'withdrawn'`),
    }));
    expect(visible).toEqual({ bulletins: [], observations: [], withdrawn: [] });
  });
});

describe('cost_items.market_item_id (AC 5)', () => {
  it('refuses an id that is no market item, and the delete of a linked item, with 23503', async () => {
    const sectionId = await raw.sectionId(ctx.orgId);
    const insert = (marketItemId: string, code: string) => marketRaw()`
      insert into public.cost_items (org_id, code, name_en, section_id, unit, market_item_id)
      values (${ctx.orgId}, ${code}, 'Glass', ${sectionId}, 'sqm', ${marketItemId})`;
    expect(await refusal(() => insert(randomUUID(), 'MKT-NONE'))).toBe('23503');
    const linked = await seedMarketItem();
    await insert(linked.id, 'MKT-LINKED');
    expect(await refusal(() => marketRaw()`delete from public.market_items where id = ${linked.id}`)).toBe('23503');
    await marketRaw()`delete from public.cost_items where org_id = ${ctx.orgId} and code = 'MKT-LINKED'`;
  });

  it('refuses a price above 10,000,000 and a month after the bulletin month at the database (S2)', async () => {
    const guarded = await seedMarketItem();
    expect(await refusal(() => seedBulletin('2001-05', [[guarded.id, '2001-05', '10000001']]))).toBe('23514');
    expect(await refusal(() => seedBulletin('2001-04', [[guarded.id, '2001-05', '100']]))).toBe('23514');
  });

  it('takes the new studio units, and a roll market item needs its pack', async () => {
    const sectionId = await raw.sectionId(ctx.orgId);
    await marketRaw()`insert into public.cost_items (org_id, code, name_en, section_id, unit)
                      values (${ctx.orgId}, 'UNIT-KG', 'Paint', ${sectionId}, 'kg')`;
    expect(await raw.count('cost_items', ctx.orgId)).toBeGreaterThan(0);
    expect(await refusal(() => seedMarketItem('roll'))).toBe('23514');
  });
});
