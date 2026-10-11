import { afterAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { type ClientPageField, normalizeClientPageChanges } from '@/lib/org/client-page-details';
import { updateClientPageDetailsCore } from '@/lib/org/client-page-details-core';
import { clientPageRevision } from '@/lib/org/client-page-revision';
import { NAMED_PHONES, NAMED_TEXTS, randomPhones, randomTexts } from './client-page-corpus';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Round D, PR-D2 (AC C4): the tightened CHECKs are never stricter than the app.
// Every input the Settings normaliser accepts, from the named w3a and
// normaliser cases and thousands of seeded random strings, is SAVED through
// the real core on the 0059 database; not one save may fail.

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

describe('C4: whatever the app accepts, the 0059 CHECKs keep', () => {
  it('saves every accepted input of the corpus, with no refusal from the database', async () => {
    const phones = [...NAMED_PHONES, ...randomPhones(1000, SEED)];
    const texts = [...NAMED_TEXTS, ...randomTexts(2000, SEED)];
    const accepted = new Map<ClientPageField, string[]>([
      ...PHONE_FIELDS.map((field) => [field, acceptedFor(field, phones)] as const),
      ...TEXT_FIELDS.map((field) => [field, acceptedFor(field, texts)] as const),
    ]);
    // The corpus must exercise the rules, not just pass through them.
    expect(accepted.get('studioPhone')).toContain('+20 00 1012345678');
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
});
