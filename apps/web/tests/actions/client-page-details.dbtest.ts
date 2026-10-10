import { afterAll, describe, expect, it } from 'vitest';
import { updateClientPageDetailsCore } from '@/lib/org/client-page-details-core';
import { CLIENT_PAGE_FIELDS, type ClientPageField } from '@/lib/org/client-page-details';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Round C, C8 (AC 42 core half, owner decision Oct 10): the studio's client
// page details are saved by an owner or admin only, exactly as normalised,
// never tripping a 0058 CHECK; every change is audited MASKED, and a change
// to a payment detail notifies every owner and admin.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const BLANK = Object.fromEntries(CLIENT_PAGE_FIELDS.map((field) => [field, ''])) as Record<
  ClientPageField,
  unknown
>;

/** `bban` with the country code and the two ISO 13616 check digits in front. */
function iban(country: string, bban: string): string {
  const digits = [...`${bban}${country}00`]
    .map((character) => (/[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character))
    .join('');
  const remainder = [...digits].reduce((sum, digit) => (sum * 10 + Number(digit)) % 97, 0);
  return `${country}${String(98 - remainder).padStart(2, '0')}${bban}`;
}

async function stored(orgId: string) {
  const [row] = await raw.query<Record<string, string | null>>(
    `select studio_phone, studio_whatsapp, instapay_address, bank_name, bank_account_holder,
            bank_account_number, bank_iban
       from public.organizations where id = '${orgId}'`,
  );
  return row;
}

async function studio() {
  const seeded = await seedOrg({
    owners: 2,
    members: [{ role: 'admin' }, { role: 'project_manager' }, { role: 'accountant' }],
  });
  orgIds.push(seeded.orgId);
  const [admin, pm, accountant] = seeded.memberIds;
  return { ...seeded, admin, pm, accountant, owner: ctxFor(seeded.orgId, seeded.ownerIds[0], 'owner') };
}

describe('updateClientPageDetailsCore', () => {
  it('refuses every role but owner and admin before writing anything', async () => {
    const { orgId, pm, accountant } = await studio();
    for (const [userId, role] of [[pm, 'project_manager'], [accountant, 'accountant']] as const) {
      const result = await updateClientPageDetailsCore(ctxFor(orgId, userId, role), { ...BLANK, studioPhone: '01012345678' }, 'X');
      expect(result).toMatchObject({ ok: false, error: 'forbidden' });
    }
    expect((await stored(orgId)).studio_phone).toBeNull();
  });

  it('stores exactly the normalised values, and the database takes them', async () => {
    const { orgId, owner } = await studio();
    const rlm = String.fromCodePoint(0x200f);
    const result = await updateClientPageDetailsCore(
      owner,
      {
        studioPhone: '010 1234 5678',
        studioWhatsapp: '٠١٠١٢٣٤٥٦٧٨',
        instapayAddress: ` studio@instapay${rlm} `,
        bankName: `${rlm}البنك الأهلي المصري`,
        bankAccountHolder: 'Studio 7',
        bankAccountNumber: '1000 2345 6789',
        bankIban: 'eg38 0019 0005 0000 0000 2631 8000 2',
      },
      'Nabil',
    );
    expect(result.ok).toBe(true);
    expect(await stored(orgId)).toEqual({
      studio_phone: '01012345678',
      studio_whatsapp: '01012345678',
      instapay_address: 'studio@instapay',
      bank_name: 'البنك الأهلي المصري',
      bank_account_holder: 'Studio 7',
      bank_account_number: '100023456789',
      bank_iban: 'EG380019000500000000263180002',
    });
  });

  it('saves the boundary values the CHECKs allow without tripping one', async () => {
    const { orgId, owner } = await studio();
    const cases: Array<Partial<Record<ClientPageField, string>>> = [
      { studioPhone: '1234567', studioWhatsapp: '+201012345678' },
      { studioPhone: '+123456789012345' },
      { instapayAddress: 'abc', bankName: 'ab', bankAccountHolder: 'ب'.repeat(120) },
      { instapayAddress: 'x'.repeat(100), bankName: 'B'.repeat(120), bankAccountNumber: '1abc' },
      { bankName: 'Bank', bankAccountNumber: `9${'A'.repeat(32)}-`, bankIban: iban('LC', 'HEMM000100010012001200023015') },
      { bankName: 'Bank', bankIban: iban('MT', `${'1'.repeat(29)}A`) },
      { bankName: 'Bank', bankIban: iban('NO', '1234567890') },
    ];
    for (const input of cases) {
      const result = await updateClientPageDetailsCore(owner, { ...BLANK, ...input }, null);
      expect(result, JSON.stringify(input)).toMatchObject({ ok: true });
    }
    expect((await stored(orgId)).bank_iban).toHaveLength(14);
  });

  it('names the field a refusal is about', async () => {
    const { owner } = await studio();
    expect(await updateClientPageDetailsCore(owner, { ...BLANK, studioPhone: '12' }, null)).toEqual({
      ok: false,
      error: 'phone_invalid',
      field: 'studioPhone',
    });
    expect(await updateClientPageDetailsCore(owner, { ...BLANK, bankAccountNumber: '1234' }, null)).toEqual({
      ok: false,
      error: 'bank_name_required',
      field: 'bankName',
    });
    expect(await updateClientPageDetailsCore(owner, null as never, null)).toEqual({ ok: false, error: 'invalid' });
  });

  it('audits a change with every number masked, and alerts every owner and admin', async () => {
    const { orgId, owner, ownerIds, admin, pm } = await studio();
    await updateClientPageDetailsCore(owner, { ...BLANK, bankName: 'CIB', bankAccountNumber: '1111222233334821' }, null);
    const result = await updateClientPageDetailsCore(
      owner,
      { ...BLANK, bankName: 'CIB', bankAccountNumber: '9999888877771234' },
      'Nabil Hakeem',
    );
    expect(result.ok).toBe(true);
    expect(result.data?.alert).toEqual({
      recipientUserIds: expect.arrayContaining([...ownerIds, admin]),
      changedBy: 'Nabil Hakeem',
      fields: ['bankAccountNumber'],
      locale: 'ar-EG',
    });
    expect(result.data?.alert?.recipientUserIds).toHaveLength(3);

    const audits = await raw.query<{ before: unknown; after: unknown }>(
      `select before, after from public.audit_log
        where org_id = '${orgId}' and entity = 'organization' order by created_at, id`,
    );
    expect(audits.at(-1)).toEqual({
      before: { bankAccountNumber: '••••4821' },
      after: { bankAccountNumber: '••••1234' },
    });
    const everyAudit = JSON.stringify(audits);
    expect(everyAudit).not.toMatch(/1111222233334821|9999888877771234/);

    const notified = await raw.query<{ recipient_user_id: string; params: Record<string, unknown> }>(
      `select recipient_user_id, params from public.notifications
        where org_id = '${orgId}' and kind = 'payment_details_changed' and body_key = 'payment_details_changed'
          and entity_type = 'organization' and entity_id = '${orgId}'`,
    );
    // Two saves changed payment details: 3 recipients each.
    expect(notified).toHaveLength(6);
    expect(new Set(notified.map((row) => row.recipient_user_id))).toEqual(new Set([...ownerIds, admin]));
    expect(notified.map((row) => row.recipient_user_id)).not.toContain(pm);
    expect(notified.some((row) => row.params.changedBy === 'Nabil Hakeem')).toBe(true);
    expect(JSON.stringify(notified)).not.toMatch(/1111222233334821|9999888877771234/);
  });

  it('a phone change is audited but alerts nobody; saving what is stored writes nothing', async () => {
    const { orgId, owner } = await studio();
    const first = await updateClientPageDetailsCore(owner, { ...BLANK, studioPhone: '01012345678' }, null);
    expect(first).toMatchObject({ ok: true, data: { alert: null } });
    const auditsAfterFirst = await raw.count('audit_log', orgId);
    const again = await updateClientPageDetailsCore(owner, { ...BLANK, studioPhone: '010 1234 5678' }, null);
    expect(again).toMatchObject({ ok: true, data: { alert: null } });
    expect(await raw.count('audit_log', orgId)).toBe(auditsAfterFirst);
    expect(await raw.count('notifications', orgId)).toBe(0);
  });

  it('answers the database owner/admin gate (MT120) with its own code', async () => {
    const { orgId, pm } = await studio();
    // A context that CLAIMS owner for a member who is a project manager: past
    // the app's gate, refused by trg_organizations_client_page_writer.
    const forged = ctxFor(orgId, pm, 'owner');
    const result = await updateClientPageDetailsCore(forged, { ...BLANK, studioPhone: '01012345678' }, null);
    expect(result).toEqual({ ok: false, error: 'client_page_details_owner_only' });
    expect((await stored(orgId)).studio_phone).toBeNull();
    expect(await raw.count('notifications', orgId)).toBe(0);
  });
});
