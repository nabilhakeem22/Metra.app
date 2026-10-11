import { createSql } from '@metra/db';
import { pgFieldOf, sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, seedOrg, teardown } from './fixture';
import { migrationSql, RUNBOOK_0059, runbookSql } from './runbook-sql';

// Round D, PR-D2: migration 0059 (AC C1 to C3, C5). Each tightened CHECK
// refuses what the plan names and keeps what the app stores; on a database
// holding a row it would refuse, the migration fails with 23514 and leaves
// every 0058 CHECK in place, and the runbook's pre-check names that row. The
// app-side differential (C4) is delivery-db-step-0059-differential.dbtest.ts.

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

describe('C1, C2: the studio numbers', () => {
  it('C1: the phone refuses what cannot ring and keeps what the app stores', async () => {
    for (const refused of ['+0000000', '1234567', '+0201012345678', '12345678', '+1234567']) {
      expect(await refusal(`studio_phone = ${quoted(refused)}`), refused).toBe('organizations_studio_phone_format');
    }
    // +2001012345678 is what the app stores for "+20 00 1012345678" (deviation D1): looser, never stricter.
    for (const kept of ['+201012345678', '01012345678', '0223456789', '+447911123456', '022345678', '+2001012345678']) {
      expect(await refusal(`studio_phone = ${quoted(kept)}`), kept).toBe('ok');
    }
  });

  it('C2: WhatsApp refuses a landline and keeps a mobile', async () => {
    for (const refused of ['0223456789', '1012345678', '+0201012345678']) {
      expect(await refusal(`studio_whatsapp = ${quoted(refused)}`), refused).toBe('organizations_studio_whatsapp_format');
    }
    for (const kept of ['01012345678', '+201012345678', '+447911123456', '+2001012345678']) {
      expect(await refusal(`studio_whatsapp = ${quoted(kept)}`), kept).toBe('ok');
    }
  });
});

describe('C3: payment text a client can read', () => {
  for (const [column, blankCount] of [['instapay_address', 3], ['bank_name', 2], ['bank_account_holder', 2]] as const) {
    it(`${column}: refuses invisible-only values and controls, keeps ordinary text`, async () => {
      const refused = [
        `repeat(chr(10240), ${blankCount})`, // U+2800 Braille blank
        `repeat(chr(4447), ${blankCount})`, // U+115F Hangul choseong filler
        `repeat(chr(65440), ${blankCount})`, // U+FFA0 halfwidth Hangul filler
        'repeat(chr(133), 3)', // U+0085 NEL
        'repeat(chr(1617), 3)', // U+0651 Arabic shadda on its own
        `'ab' || chr(1)`, // a C0 control
      ];
      for (const value of refused) {
        expect(await refusal(`${column} = ${value}`), value).toBe('organizations_payment_text_printable');
      }
      for (const value of ['CIB', 'بنك مصر', 'studio@instapay']) {
        expect(await refusal(`${column} = ${quoted(value)}`), value).toBe('ok');
      }
    });
  }
});

class RolledBack extends Error {}

describe('C5: a violating row stops the migration, and the runbook names it', () => {
  const sql = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
  afterAll(async () => {
    await sql.end();
  });

  it('fails with 23514, keeps the 0058 CHECKs, and step 2 (b) returns exactly the three planted rows', async () => {
    const planted = await Promise.all([1, 2, 3].map(() => seedOrg({ owners: 1 })));
    orgIds.push(...planted.map((org) => org.orgId));
    const assignments = [`studio_phone = '1234567'`, `studio_whatsapp = '0223456789'`, 'bank_name = repeat(chr(10240), 2)'];
    const DEFINITIONS = `select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conname in ('organizations_studio_phone_format', 'organizations_studio_whatsapp_format',
                        'organizations_payment_text_printable') order by conname`;
    const outcome = await sql
      .begin(async (tx) => {
        await tx.unsafe(runbookSql(RUNBOOK_0059.restore));
        const restored = await tx.unsafe(DEFINITIONS);
        for (const [index, org] of planted.entries()) {
          await tx.unsafe(
            `select set_config('app.current_org_id', '${org.orgId}', true), set_config('app.current_user_id', '${org.ownerIds[0]}', true)`,
          );
          await tx.unsafe(`update public.organizations set ${assignments[index]} where id = '${org.orgId}'`);
        }
        const violators = await tx.unsafe(runbookSql(RUNBOOK_0059.violators));
        const migrated = await tx
          .savepoint((savepoint) => savepoint.unsafe(migrationSql('0059_client_page_checks_tightened')))
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
    expect(JSON.stringify(outcome.restored)).toContain('{7,15}');
    const violatorIds = (outcome.violators as Array<{ id: string }>).map((row) => row.id).sort();
    expect(violatorIds).toEqual(planted.map((org) => org.orgId).sort());
    expect(await raw.query(runbookSql(RUNBOOK_0059.violators))).toEqual([]);
  });
});
