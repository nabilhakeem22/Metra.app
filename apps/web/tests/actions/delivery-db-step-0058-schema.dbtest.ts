import { sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, seedOrg, teardown } from './fixture';
import { seedRoundBDelivery } from './round-b-fixture';

// Round C, PR-C7: migration 0058 (AC 32). Nine nullable columns, eight CHECKs,
// each CHECK bites with 23514 and lets its boundary values through.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const NEW_COLUMNS = [
  'bank_account_holder', 'bank_account_number', 'bank_iban', 'bank_name', 'client_expected_on',
  'client_expected_state', 'instapay_address', 'studio_phone', 'studio_whatsapp',
];

describe('0058 columns and CHECKs (AC 32)', () => {
  it('adds the nine columns with the stated types, all nullable', async () => {
    const rows = await raw.query<{ table_name: string; column_name: string; data_type: string; udt_name: string; is_nullable: string }>(
      `select table_name, column_name, data_type, udt_name, is_nullable from information_schema.columns
        where table_schema = 'public' and column_name in (${NEW_COLUMNS.map((c) => `'${c}'`).join(', ')})
        order by table_name, column_name`,
    );
    expect(rows).toEqual([
      { table_name: 'design_engagements', column_name: 'client_expected_on', data_type: 'date', udt_name: 'date', is_nullable: 'YES' },
      { table_name: 'design_engagements', column_name: 'client_expected_state', data_type: 'USER-DEFINED', udt_name: 'design_engagement_state', is_nullable: 'YES' },
      ...['bank_account_holder', 'bank_account_number', 'bank_iban', 'bank_name', 'instapay_address', 'studio_phone', 'studio_whatsapp'].map(
        (column_name) => ({ table_name: 'organizations', column_name, data_type: 'text', udt_name: 'text', is_nullable: 'YES' }),
      ),
    ]);
  });

  it('creates the eight CHECKs by name', async () => {
    const rows = await raw.query<{ conname: string }>(
      `select conname from pg_constraint where contype = 'c' and conname in (
         'organizations_studio_phone_format', 'organizations_studio_whatsapp_format',
         'organizations_instapay_address_length', 'organizations_bank_text_length',
         'organizations_bank_account_number_format', 'organizations_bank_iban_format',
         'organizations_bank_account_needs_bank', 'design_engagements_client_expected_pair')
       order by conname`,
    );
    expect(rows).toHaveLength(8);
  });

  /** Apply one assignment to a fresh org; the SQLSTATE, or 'ok'. */
  async function tryOrg(assignment: string): Promise<string> {
    const { orgId } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    return raw
      .query(`update public.organizations set ${assignment} where id = '${orgId}'`)
      .then(() => 'ok', (error: unknown) => sqlstateOf(error) ?? 'unknown');
  }

  const long = (n: number) => 'x'.repeat(n);
  const VIOLATIONS: Array<[string, string]> = [
    ['organizations_studio_phone_format', `studio_phone = '123456'`],
    ['organizations_studio_phone_format (16 digits)', `studio_phone = '1234567890123456'`],
    ['organizations_studio_phone_format (spaces)', `studio_phone = '010 1234 5678'`],
    ['organizations_studio_whatsapp_format', `studio_whatsapp = 'abc1234567'`],
    ['organizations_instapay_address_length', `instapay_address = 'ab'`],
    ['organizations_instapay_address_length (101)', `instapay_address = '${long(101)}'`],
    ['organizations_bank_text_length (name)', `bank_name = 'B'`],
    ['organizations_bank_text_length (holder)', `bank_account_holder = '${long(121)}'`],
    ['organizations_bank_account_number_format', `bank_name = 'CIB', bank_account_number = '12 3'`],
    ['organizations_bank_iban_format', `bank_name = 'CIB', bank_iban = 'eg380019000500000000263180002'`],
    ['organizations_bank_account_needs_bank (iban)', `bank_iban = 'EG380019000500000000263180002'`],
    ['organizations_bank_account_needs_bank (number)', `bank_account_number = '100023456789'`],
  ];
  for (const [label, assignment] of VIOLATIONS) {
    it(`refuses ${label} with 23514`, async () => {
      expect(await tryOrg(assignment)).toBe('23514');
    });
  }

  it('lets every boundary value through', async () => {
    for (const assignment of [
      `studio_phone = '1234567', studio_whatsapp = '+123456789012345'`,
      `studio_phone = '+201012345678', studio_whatsapp = '01012345678'`,
      `instapay_address = 'abc'`,
      `instapay_address = '${long(100)}'`,
      `bank_name = 'BM', bank_account_holder = '${long(120)}'`,
      `bank_name = '${long(120)}', bank_account_holder = 'Al'`,
      `bank_name = 'CIB', bank_account_number = '1234'`,
      `bank_name = 'CIB', bank_account_number = '${'9'.repeat(34)}'`,
      `bank_name = 'NBE', bank_iban = 'EG380019000500000000263180002'`,
    ]) {
      expect(await tryOrg(assignment), assignment).toBe('ok');
    }
  });

  it('pairs the expected date with its stage', async () => {
    const d = await seedRoundBDelivery(orgIds, 'expected-pair');
    const set = (assignment: string) =>
      raw
        .query(`update public.design_engagements set ${assignment} where id = '${d.engagementId}'`)
        .then(() => 'ok', (error: unknown) => sqlstateOf(error) ?? 'unknown');
    expect(await set(`client_expected_on = '2026-11-01'`)).toBe('23514');
    expect(await set(`client_expected_state = 'concept_review'`)).toBe('23514');
    expect(await set(`client_expected_on = '2026-11-01', client_expected_state = 'concept_review'`)).toBe('ok');
    expect(await set(`client_expected_on = null, client_expected_state = null`)).toBe('ok');
  });
});
