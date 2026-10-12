import { createSql } from '@metra/db';
import { pgFieldOf, sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, seedOrg, teardown } from './fixture';
import { migrationSql, RUNBOOK_0060, runbookSql } from './runbook-sql';

// Round E (0060), AC K1 to K3 and K5. The phone and WhatsApp CHECKs refuse
// `+200` (Egypt's code with its trunk 0 kept) and nothing else new; the
// printable CHECK refuses U+2028 and U+2029 anywhere and a value of U+1D159
// alone, and keeps "CIB" with U+1D159 beside it, as the app does. On a database
// holding a row 0060 would refuse, the migration fails with 23514 and leaves
// every 0059 CHECK in place, and the runbook's pre-check names that row. The
// app-side differential (K4) is delivery-db-step-0059-differential.dbtest.ts.

const orgIds: string[] = [];
let orgId = '';
let ownerId = '';
beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  [orgId, ownerId] = [seeded.orgId, seeded.ownerIds[0]];
});
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Apply one assignment as the studio's owner: 'ok', or the constraint that refused it. */
async function refusal(assignment: string): Promise<string> {
  return raw
    .query(
      `select set_config('app.current_org_id', '${orgId}', true), set_config('app.current_user_id', '${ownerId}', true);
       update public.organizations set ${assignment} where id = '${orgId}'`,
    )
    .then(() => 'ok', (error: unknown) => pgFieldOf(error, 'constraint_name') ?? sqlstateOf(error) ?? 'unknown');
}

const quoted = (value: string) => `'${value}'`;

describe('K1, K2: no +200 number', () => {
  it('K1: the phone refuses +200 and keeps every other number 0059 kept', async () => {
    for (const refused of ['+2001012345678', '+2000012345678', '+20012345678']) {
      expect(await refusal(`studio_phone = ${quoted(refused)}`), refused).toBe('organizations_studio_phone_format');
    }
    for (const kept of ['+201012345678', '01012345678', '0223456789', '+447911123456', '+212612345678']) {
      expect(await refusal(`studio_phone = ${quoted(kept)}`), kept).toBe('ok');
    }
  });

  it('K2: WhatsApp refuses +200 and a landline, and keeps a mobile', async () => {
    for (const refused of ['+2001012345678', '0223456789']) {
      expect(await refusal(`studio_whatsapp = ${quoted(refused)}`), refused).toBe('organizations_studio_whatsapp_format');
    }
    for (const kept of ['+201012345678', '01012345678']) {
      expect(await refusal(`studio_whatsapp = ${quoted(kept)}`), kept).toBe('ok');
    }
  });
});

/** Round E (S3): unassigned default-ignorables alone (U+FFF0, U+FFF8, U+E0000, U+E0002, U+E0080, U+E01F0, U+E0FFF). */
const UNASSIGNED_ALONE = [65520, 65528, 917504, 917506, 917632, 917999, 921599].map((codePoint) => `repeat(chr(${codePoint}), 3)`);

describe('K3: line separators anywhere, the null notehead alone, unassigned ignorables alone', () => {
  for (const column of ['instapay_address', 'bank_name', 'bank_account_holder']) {
    it(column, async () => {
      for (const value of [`'CI' || chr(8232) || 'B'`, `'CI' || chr(8233) || 'B'`, 'repeat(chr(119129), 3)', ...UNASSIGNED_ALONE]) {
        expect(await refusal(`${column} = ${value}`), value).toBe('organizations_payment_text_printable');
      }
      for (const value of [`'CIB' || chr(119129)`, `'CIB' || chr(917506)`, quoted('CIB'), quoted('studio@instapay'), quoted('بنك مصر')]) {
        expect(await refusal(`${column} = ${value}`), value).toBe('ok');
      }
      // Every 0059 C3 refusal still holds (delivery-db-step-0059-checks runs the full list on this database).
      for (const value of ['repeat(chr(10240), 3)', `'ab' || chr(1)`, 'repeat(chr(65039), 3)', 'repeat(chr(57344), 3)']) {
        expect(await refusal(`${column} = ${value}`), value).toBe('organizations_payment_text_printable');
      }
    });
  }
});

class RolledBack extends Error {}

describe('K5: a +200 row stops the migration, and the runbook names it', () => {
  const sql = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
  afterAll(async () => {
    await sql.end();
  });

  it('fails with 23514, keeps the 0059 CHECKs, and step 2 (b) returns exactly the planted row', async () => {
    const planted = await seedOrg({ owners: 1 });
    orgIds.push(planted.orgId);
    const DEFINITIONS = `select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conname in ('organizations_studio_phone_format', 'organizations_studio_whatsapp_format',
                        'organizations_payment_text_printable') order by conname`;
    const outcome = await sql
      .begin(async (tx) => {
        await tx.unsafe(runbookSql(RUNBOOK_0060.restore));
        const restored = await tx.unsafe(DEFINITIONS);
        await tx.unsafe(
          `select set_config('app.current_org_id', '${planted.orgId}', true), set_config('app.current_user_id', '${planted.ownerIds[0]}', true)`,
        );
        await tx.unsafe(`update public.organizations set studio_phone = '+2001012345678' where id = '${planted.orgId}'`);
        const violators = await tx.unsafe(runbookSql(RUNBOOK_0060.violators));
        const migrated = await tx
          .savepoint((savepoint) => savepoint.unsafe(migrationSql('0060_client_page_checks_round_e')))
          .then(() => 'ok', (error: unknown) => sqlstateOf(error) ?? 'unknown');
        const after = await tx.unsafe(DEFINITIONS);
        throw Object.assign(new RolledBack(), { restored, violators, migrated, after });
      })
      .catch((error: unknown) => {
        if (error instanceof RolledBack) return error as RolledBack & Record<string, unknown>;
        throw error;
      });
    expect(outcome.migrated).toBe('23514');
    expect(outcome.after).toEqual(outcome.restored);
    expect(JSON.stringify(outcome.restored)).not.toContain('+200');
    const violators = outcome.violators as Array<{ id: string; phone_ok: boolean; whatsapp_ok: boolean; payment_text_ok: boolean }>;
    expect(violators.map(({ id, phone_ok, whatsapp_ok, payment_text_ok }) => ({ id, phone_ok, whatsapp_ok, payment_text_ok }))).toEqual([
      { id: planted.orgId, phone_ok: false, whatsapp_ok: true, payment_text_ok: true },
    ]);
    expect(await raw.query(runbookSql(RUNBOOK_0060.violators))).toEqual([]);
  });
});
