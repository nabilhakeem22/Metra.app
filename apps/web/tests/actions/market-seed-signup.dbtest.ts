import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { closeMarketFixture, marketRaw } from './market-fixture';
import {
  afterTasks, clearSeedFixture, cliSeed, createStudio, emptySeedBook, publishSeedFixture, rebuildSeedBook, runAfterResponse,
  seedAudits, seededRows, signUp,
} from './market-seed-fixture';

// Every new studio gets the market price book at sign-up, after the response:
// exactly what market:seed-price-books gives a studio, never at the cost of
// the sign-up itself, and nothing at all while no bulletin is published.

vi.mock('next/server', () => ({ after: (task: () => Promise<unknown>) => void afterTasks.push(task) }));

const orgIds: string[] = [];

afterAll(async () => {
  await marketRaw()`drop trigger if exists dbtest_refuse_signup_seed on public.cost_items`;
  await marketRaw()`drop function if exists public.dbtest_refuse_signup_seed()`;
  await teardown(orgIds);
  await clearSeedFixture();
  await closeMarketFixture();
  await closeFixture();
});

describe('no bulletin published', () => {
  it('creates the studio and seeds nothing, without an error', async () => {
    await emptySeedBook();
    const errors = vi.spyOn(console, 'error');
    const ctx = await signUp(orgIds, 'Signup no bulletin');
    await runAfterResponse();
    expect(await raw.count('memberships', ctx.orgId)).toBe(1);
    expect(await seededRows(ctx.orgId)).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('a published market book', () => {
  beforeAll(async () => {
    await publishSeedFixture();
    await rebuildSeedBook();
  });

  it('gives the new studio exactly what market:seed-price-books gives its twin', async () => {
    const signedUp = await signUp(orgIds, 'Signup studio');
    const twin = await createStudio(orgIds, 'CLI twin');
    await runAfterResponse();
    await cliSeed(twin.orgId);
    const rows = await seededRows(signedUp.orgId);
    expect(rows).toEqual(await seededRows(twin.orgId));
    const fixture = rows.filter((row) => String(row.name_en).startsWith('Seed test')).map(({ name_ar, unit, cost, price, active, section_key }) => ({ name_ar, unit, cost, price, active, section_key }));
    expect(fixture.sort((a, b) => String(a.name_ar).localeCompare(String(b.name_ar)))).toEqual([
      { name_ar: 'زجاج بذر الاختبار', unit: 'sqm', cost: '467.0000', price: '490.3500', active: true, section_key: 'market.finishing.glass' },
      { name_ar: 'سلك بذر الاختبار لفة 100 م', unit: 'roll', cost: '30.4550', price: '31.9778', active: true, section_key: 'market.finishing.glass' },
    ]);
    const audits = await seedAudits(signedUp.orgId);
    expect(audits.map(({ source, ...rest }) => [source, rest])).toEqual(
      (await seedAudits(twin.orgId)).map(({ source, ...rest }) => [source === 'market:seed-price-books' ? 'market:seed-on-signup' : source, rest]),
    );
  });

  it('never fails the sign-up: a refused seed leaves the studio, writes nothing and logs one redacted line', async () => {
    await marketRaw().unsafe(`create function public.dbtest_refuse_signup_seed() returns trigger language plpgsql as $$
      begin
        if new.code like 'MKT-%' and exists (select 1 from public.organizations o where o.id = new.org_id and o.name_en = 'Signup refused') then
          raise exception 'dbtest: this studio refuses seeded items';
        end if;
        return new;
      end $$`);
    await marketRaw().unsafe('create trigger dbtest_refuse_signup_seed before insert on public.cost_items for each row execute function public.dbtest_refuse_signup_seed()');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ctx = await signUp(orgIds, 'Signup refused');
    await runAfterResponse();
    expect(await raw.count('memberships', ctx.orgId)).toBe(1);
    expect(await seededRows(ctx.orgId)).toEqual([]);
    expect(await raw.query(`select id from sections where org_id = '${ctx.orgId}' and key like 'market.%'`)).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(errors.mock.calls[0]);
    expect(line).toContain('market seed on sign-up failed');
    expect(line).toContain('P0001');
    expect(line).not.toMatch(/insert into|params|MKT-|\d{3,}\.\d{4}/);
    errors.mockRestore();
  });
});
