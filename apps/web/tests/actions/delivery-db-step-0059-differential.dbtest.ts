import { createSql } from '@metra/db';
import { afterAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { type ClientPageField, normalizeClientPageChanges } from '@/lib/org/client-page-details';
import { updateClientPageDetailsCore } from '@/lib/org/client-page-details-core';
import { clientPageRevision } from '@/lib/org/client-page-revision';
import { NAMED_PHONES, NAMED_TEXTS, randomPhones, randomTexts } from './client-page-corpus';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Round D, PR-D2 (AC C4) and Round E (K4): the CHECKs are never stricter than
// the app. Every input the Settings normaliser accepts, from the named w3a,
// normaliser and 0060 cases and thousands of seeded random strings, is SAVED
// through the real core on the 0060 database; not one save may fail.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const PHONE_FIELDS: ClientPageField[] = ['studioPhone', 'studioWhatsapp'];
const TEXT_FIELDS: ClientPageField[] = ['instapayAddress', 'bankName', 'bankAccountHolder'];
const SEED = 59;

async function revisionOf(orgId: string): Promise<string> {
  const [row] = await raw.query<Record<ClientPageField, string | null>>(
    `select studio_phone as "studioPhone", studio_whatsapp as "studioWhatsapp", instapay_address as "instapayAddress",
            bank_name as "bankName", bank_account_holder as "bankAccountHolder",
            bank_account_number as "bankAccountNumber", bank_iban as "bankIban"
       from public.organizations where id = '${orgId}'`,
  );
  return clientPageRevision(row);
}

/** The inputs the normaliser accepts for one field. */
function acceptedFor(field: ClientPageField, inputs: readonly string[]): string[] {
  return inputs.filter((input) => normalizeClientPageChanges({ [field]: input }).ok);
}

/** One save per row: row i carries the i-th accepted input of every field that has one. */
function saveRows(accepted: Map<ClientPageField, string[]>): Array<Partial<Record<ClientPageField, string>>> {
  const rows = Math.max(...[...accepted.values()].map((inputs) => inputs.length));
  return Array.from({ length: rows }, (_, index) =>
    Object.fromEntries([...accepted].filter(([, inputs]) => index < inputs.length).map(([field, inputs]) => [field, inputs[index]])),
  );
}

describe('C4, K4: whatever the app accepts, the 0060 CHECKs keep', () => {
  it('saves every accepted input of the corpus, with no refusal from the database', async () => {
    const phones = [...NAMED_PHONES, ...randomPhones(1000, SEED)];
    const texts = [...NAMED_TEXTS, ...randomTexts(2000, SEED)];
    const accepted = new Map<ClientPageField, string[]>([
      ...PHONE_FIELDS.map((field) => [field, acceptedFor(field, phones)] as const),
      ...TEXT_FIELDS.map((field) => [field, acceptedFor(field, texts)] as const),
    ]);
    // The corpus must exercise the rules, not just pass through them.
    expect(accepted.get('studioPhone')).toContain('+20 00 1012345678');
    // K4: the 0060 cases reach the database (the +200 forms stored without their zeros).
    for (const phone of ['+20 00 10 1234 5678', '+20 000 1012345678', '0020 0 10 1234 5678', '+200 10 1234 5678']) {
      expect(accepted.get('studioPhone'), phone).toContain(phone);
      expect(accepted.get('studioWhatsapp'), phone).toContain(phone);
    }
    for (const text of [`CIB${String.fromCodePoint(0x1d159)}`, `${String.fromCodePoint(0x2028)}CIB`, `CIB${String.fromCodePoint(0x2028)}`]) {
      for (const field of TEXT_FIELDS) expect(accepted.get(field), field).toContain(text);
    }
    for (const field of TEXT_FIELDS) expect(accepted.get(field)!.length, field).toBeGreaterThan(500);
    for (const field of PHONE_FIELDS) expect(accepted.get(field)!.length, field).toBeGreaterThan(100);

    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const owner: OrgContext = ctxFor(orgId, ownerIds[0], 'owner');
    const failures: Array<{ changes: unknown; error: string | undefined }> = [];
    for (const changes of saveRows(accepted)) {
      const result = await updateClientPageDetailsCore(owner, { revision: await revisionOf(orgId), changes });
      if (!result.ok) failures.push({ changes, error: result.error });
    }
    expect(failures).toEqual([]);
  }, 600_000);

  it('keeps every value of one code point, three times over, that the app would store (all of Unicode)', async () => {
    const stored: string[] = [];
    for (let codePoint = 1; codePoint <= 0x10ffff; codePoint += 1) {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
      const result = normalizeClientPageChanges({ bankName: String.fromCodePoint(codePoint).repeat(3) });
      if (result.ok && result.value.bankName) stored.push(result.value.bankName);
    }
    expect(stored.length).toBeGreaterThan(100_000);
    const connection = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
    try {
      const [{ def }] = await connection.unsafe<Array<{ def: string }>>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'organizations_payment_text_printable'`,
      );
      // The live CHECK's own expression, over the three columns at once.
      const refused = await connection.unsafe<Array<{ value: string }>>(
        `select o.bank_name as value from unnest($1::text[]) as t(value),
           lateral (select t.value as instapay_address, t.value as bank_name, t.value as bank_account_holder) o
          where not ${def.slice('CHECK '.length)}`,
        [stored],
      );
      expect(refused.map(({ value }) => value.codePointAt(0)!.toString(16))).toEqual([]);
    } finally {
      await connection.end();
    }
  }, 600_000);
});
