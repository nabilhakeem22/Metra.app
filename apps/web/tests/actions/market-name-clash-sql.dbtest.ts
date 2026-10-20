import { comparisonForm } from '@metra/db/market-seed';
import { comparisonFormSql, comparisonRulesSql } from '@metra/db/market-seed/compare-sql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';
import { closeMarketFixture, marketRaw } from './market-fixture';

// The add's name-clash check compares names in Postgres (comparisonFormSql,
// R1): the SQL form must read alike every two names comparisonForm reads
// alike, or a clash the seed refuses would be let through by the add. It is
// comparisonForm's form exactly, with ς written σ (its one, safe, difference;
// packages/db market-seed/compare-sql.ts). Checked on every name the database
// holds (the published bulletin's on a database that has one), the spellings
// a studio types interchangeably, and every assigned code point Postgres knows,
// in runs of 16 so each sits beside its neighbours.

const orgIds: string[] = [];
let ctx: OrgContext;

beforeAll(async () => {
  const studio = await seedOrg({ owners: 1 });
  orgIds.push(studio.orgId);
  ctx = ctxFor(studio.orgId, studio.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await closeMarketFixture();
  await closeFixture();
});

/** Assigned in this runtime's Unicode, never a surrogate: an unassigned neighbour would only make Postgres skip the whole run. */
const isAssigned = (point: number) => (point < 0xd800 || point > 0xdfff) && /\p{Assigned}/u.test(String.fromCodePoint(point));

const expected = (text: string) => comparisonForm(text).replace(/ς/g, 'σ');

/** Each text in the SQL form, and whether Postgres's Unicode assigns all its characters (a newer runtime's are skipped). */
async function sqlForms(texts: string[]): Promise<Array<{ form: string; assigned: boolean }>> {
  return withOrgContext(ctx, async (tx) =>
    (await tx.execute(sql`
      with ${comparisonRulesSql()}
      select ${comparisonFormSql(sql`input.text`)} as form, unicode_assigned(input.text) as assigned
        from json_array_elements_text(${JSON.stringify(texts)}::text::json) with ordinality as input(text, position)
       order by input.position`)) as unknown as Array<{ form: string; assigned: boolean }>,
  );
}

async function differences(texts: string[]): Promise<Array<{ text: string; sql: string; js: string }>> {
  const forms = await sqlForms(texts);
  return texts
    .map((text, index) => ({ text, sql: forms[index].form, js: expected(text), assigned: forms[index].assigned }))
    .filter((row) => row.assigned && row.sql !== row.js)
    .map(({ text, sql: form, js }) => ({ text, sql: form, js }));
}

const ALIKE: Array<[string, string]> = [
  ['أسمنت إضافات آلي', 'اسمنت اضافات الي'],
  ['مادة', 'ماده'],
  ['مبنى', 'مبني'],
  ['جِبسٌ مُقَوّى', 'جبس مقوي'],
  ['مـــادة', 'ماده'],
  ['  لوح\u00a0\u00a0جبس\t\n', 'لوح جبس'],
  ['ﻻﻣﺒﺔ', 'لامبه'],
  ['بولی پروپیلین کابل', 'بولي پروپيلين كابل'],
  ['نحاس ٢ مم و ۱۲', 'نحاس 2 مم و 12'],
  ['زجاج\u200f شفاف\u200d', 'زجاج شفاف'],
  ['CEMENT Board', 'cement board'],
  ['CAFÉ', 'café'],
  ['Cafe\u0301', 'café'],
  ['ﬁre ＡＢＣ', 'fire abc'],
  ['\u212a', 'k'],
  // Not alike to comparisonForm (οδος, οδοσ): the safe difference, an extra clash.
  ['ΟΔΟΣ', 'οδοσ'],
];

const APART: Array<[string, string]> = [
  ['لوح جبس', 'لوح جبسي'],
  ['Cafe', 'Café'],
  ['İzmir', 'Izmir'],
  ['10 mm', '100 mm'],
];

describe('comparisonFormSql folds as comparisonForm does', () => {
  it('on every name the database holds: market items, the seed book and its forms, and every studio item', async () => {
    const rows = await marketRaw()<Array<{ text: string }>>`
      select distinct text from (
        select unnest(array[name_ar, name_en, spec_ar, spec_en, unit_label_ar]) as text from public.market_items
        union all select unnest(array[name_ar, name_en, leaf_name_ar, leaf_name_en, top_name_ar, top_name_en]) from public.market_seed_book
        union all select unnest(name_forms) from public.market_seed_book
        union all select unnest(array[name_ar, name_en]) from public.cost_items
      ) names where text is not null`;
    const texts = rows.map((row) => row.text);
    expect(texts.length).toBeGreaterThan(0);
    expect(await differences(texts)).toEqual([]);
  });

  it('on the spellings a studio types interchangeably, and the ones it does not', async () => {
    const pairs = [...ALIKE, ...APART];
    const forms = (await sqlForms(pairs.flat())).map((row) => row.form);
    expect(await differences(pairs.flat())).toEqual([]);
    expect(ALIKE.map((_, index) => forms[2 * index] === forms[2 * index + 1])).toEqual(ALIKE.map(() => true));
    expect(APART.map((_, index) => forms[2 * (ALIKE.length + index)] === forms[2 * (ALIKE.length + index) + 1])).toEqual(APART.map(() => false));
  });

  it('on every assigned code point of planes 0 to 3 and the tags and variation selectors of plane 14, in runs of 16', async () => {
    const runs: string[] = [];
    for (const [first, last] of [[0x1, 0x3ffff], [0xe0000, 0xe01ef]]) {
      for (let start = first; start <= last; start += 16) {
        const points = Array.from({ length: Math.min(16, last - start + 1) }, (_, offset) => start + offset).filter(isAssigned);
        if (points.length > 0) runs.push(String.fromCodePoint(...points));
      }
    }
    expect(await differences(runs)).toEqual([]);
  });
});
