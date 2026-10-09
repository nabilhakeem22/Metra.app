import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, seedOrg, teardown } from './fixture';
import { updateOrganization } from './round-c-org-fixture';

// Round C, PR-C7 fix round (S4, F8): organizations_payment_text_printable. The
// InstaPay address, bank name and account holder are what a client copies
// into a banking app, so each needs one visible character and may hold no
// Unicode format character (category Cf: zero-width and bidirectional
// controls). The CHECK spells both classes code point by code point (no
// locale dependence); this suite holds it to Unicode itself, as this Node
// knows it, over EVERY Cf and white-space code point.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

function codePointsMatching(pattern: RegExp): number[] {
  const found: number[] = [];
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    if (pattern.test(String.fromCodePoint(codePoint))) found.push(codePoint);
  }
  return found;
}

const FORMAT = codePointsMatching(/^\p{Cf}$/u);
const WHITE_SPACE = codePointsMatching(/^\s$/u).filter((codePoint) => codePoint !== 0);

/**
 * Try `column = <value built from each code point>` on one org as its owner,
 * inside one DO block; answers 'none' when the database refused every one, or
 * the error naming the code points it ACCEPTED.
 */
async function acceptedOf(column: string, valueSql: string, codePoints: number[]): Promise<string> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  return raw
    .query(
      `select set_config('app.current_org_id', '${orgId}', true),
              set_config('app.current_user_id', '${ownerIds[0]}', true);
       do $$
       declare
         cp int;
         accepted int[] := '{}';
       begin
         foreach cp in array array[${codePoints.join(', ')}]::int[] loop
           begin
             update public.organizations set ${column} = ${valueSql} where id = '${orgId}';
             accepted := accepted || cp;
           exception when check_violation then null;
           end;
         end loop;
         if cardinality(accepted) > 0 then
           raise exception 'accepted code points: %', accepted;
         end if;
       end
       $$;`,
    )
    .then(() => 'none', (error: unknown) => (error instanceof Error ? error.message : String(error)));
}

describe('payment free text is printable (S4, F8)', () => {
  it('knows the Unicode it is checking against', () => {
    expect(FORMAT.length).toBeGreaterThanOrEqual(170);
    expect(FORMAT).toEqual(expect.arrayContaining([0x200b, 0x200f, 0x202e, 0x2066, 0xfeff, 0x061c]));
    expect(WHITE_SPACE).toEqual(expect.arrayContaining([0x20, 0xa0, 0x3000, 0x2028]));
  });

  for (const column of ['bank_name', 'bank_account_holder', 'instapay_address']) {
    it(`${column}: refuses every Unicode format character, anywhere in the value`, async () => {
      expect(await acceptedOf(column, `'Studio' || chr(cp) || 'Pay'`, FORMAT)).toBe('none');
    });

    it(`${column}: refuses a value made only of white space, of any kind`, async () => {
      expect(await acceptedOf(column, `repeat(chr(cp), 3)`, WHITE_SPACE)).toBe('none');
    });
  }

  it('keeps Arabic with its marks, Latin, digits and ordinary spaces', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const owner = { userId: ownerIds[0] };
    for (const assignment of [
      `bank_name = 'البنك الأهلي المصري', bank_account_holder = 'مُحَمَّد علي'`,
      `bank_name = 'Banque Misr', bank_account_holder = 'Studio 7 LLC'`,
      `instapay_address = 'studio.7@instapay'`,
      `instapay_address = ' x '`,
    ]) {
      expect(await updateOrganization(orgId, assignment, owner), assignment).toBe('ok');
    }
  });
});
