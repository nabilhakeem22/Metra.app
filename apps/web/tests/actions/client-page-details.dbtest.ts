import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { updateClientPageDetailsCore } from '@/lib/org/client-page-details-core';
import type { ClientPageField } from '@/lib/org/client-page-details';
import { clientPageRevision } from '@/lib/org/client-page-revision';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Round C, C8 (AC 42 core half; owner decisions Oct 10; fix round F1, F4, S1,
// S2, S3, S4): the studio's client page details are saved by an owner or admin
// only, as a set of CHANGES against the revision the sheet loaded, exactly as
// normalised, never tripping a 0058 CHECK; every change is audited masked and
// fingerprinted, and EVERY change notifies every owner and admin (only the email
// is limited).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});
afterEach(() => {
  delete process.env.SHARE_LINK_SECRET;
});

const COLUMNS = `studio_phone as "studioPhone", studio_whatsapp as "studioWhatsapp",
  instapay_address as "instapayAddress", bank_name as "bankName", bank_account_holder as "bankAccountHolder",
  bank_account_number as "bankAccountNumber", bank_iban as "bankIban"`;

async function stored(orgId: string) {
  const [row] = await raw.query<Record<ClientPageField, string | null>>(
    `select ${COLUMNS} from public.organizations where id = '${orgId}'`,
  );
  return row;
}

/** A save as the sheet sends it: the revision of what is stored now, and the changes. */
async function save(ctx: OrgContext, changes: Partial<Record<ClientPageField, string | null>>, now?: Date) {
  return updateClientPageDetailsCore(ctx, { revision: clientPageRevision(await stored(ctx.orgId)), changes }, now);
}

/** `bban` with the country code and the two ISO 13616 check digits in front. */
function iban(country: string, bban: string): string {
  const digits = [...`${bban}${country}00`]
    .map((character) => (/[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character))
    .join('');
  const remainder = [...digits].reduce((sum, digit) => (sum * 10 + Number(digit)) % 97, 0);
  return `${country}${String(98 - remainder).padStart(2, '0')}${bban}`;
}

async function alertsOf(orgId: string) {
  return raw.query<{ recipient_user_id: string; params: Record<string, unknown> }>(
    `select recipient_user_id, params from public.notifications
      where org_id = '${orgId}' and kind = 'client_page_details_changed'
        and body_key = 'client_page_details_changed' and entity_type = 'organization' and entity_id = '${orgId}'`,
  );
}

async function studio() {
  const seeded = await seedOrg({
    owners: 2,
    members: [{ role: 'admin' }, { role: 'admin' }, { role: 'project_manager' }, { role: 'accountant' }],
  });
  orgIds.push(seeded.orgId);
  const [admin, admin2, pm, accountant] = seeded.memberIds;
  const ctx = (userId: string, role: 'owner' | 'admin' = 'owner') => ctxFor(seeded.orgId, userId, role);
  return { ...seeded, admin, admin2, pm, accountant, owner: ctx(seeded.ownerIds[0]), owner2: ctx(seeded.ownerIds[1]), ctx };
}

describe('updateClientPageDetailsCore: who and what', () => {
  it('refuses every role but owner and admin before writing anything', async () => {
    const { orgId, pm, accountant } = await studio();
    for (const [userId, role] of [[pm, 'project_manager'], [accountant, 'accountant']] as const) {
      expect(await save(ctxFor(orgId, userId, role), { studioPhone: '01012345678' })).toMatchObject({ ok: false, error: 'forbidden' });
    }
    expect((await stored(orgId)).studioPhone).toBeNull();
  });

  it('stores exactly the normalised values, and the database takes them', async () => {
    const { orgId, owner } = await studio();
    const rlm = String.fromCodePoint(0x200f);
    const result = await save(owner, {
      studioPhone: '+20 (0)10 1234 5678',
      studioWhatsapp: '٠١٠١٢٣٤٥٦٧٨',
      instapayAddress: ` studio@instapay${rlm} `,
      bankName: `${rlm}البنك الأهلي المصري`,
      bankAccountHolder: 'Studio 7',
      bankAccountNumber: '1000 2345 6789',
      bankIban: 'eg38 0019 0005 0000 0000 2631 8000 2',
    });
    expect(result.ok).toBe(true);
    expect(await stored(orgId)).toEqual({
      studioPhone: '+201012345678',
      studioWhatsapp: '01012345678',
      instapayAddress: 'studio@instapay',
      bankName: 'البنك الأهلي المصري',
      bankAccountHolder: 'Studio 7',
      bankAccountNumber: '100023456789',
      bankIban: 'EG380019000500000000263180002',
    });
  });

  it('saves the boundary values the CHECKs allow without tripping one', async () => {
    const { orgId, owner } = await studio();
    const cases: Array<Partial<Record<ClientPageField, string>>> = [
      { studioPhone: '022345678', studioWhatsapp: '+12345678' },
      { studioPhone: '+123456789012345' },
      { instapayAddress: 'abc', bankName: 'ab', bankAccountHolder: 'ب'.repeat(120) },
      { instapayAddress: 'x'.repeat(100), bankName: 'B'.repeat(120), bankAccountNumber: '1abc' },
      { bankAccountNumber: `9${'A'.repeat(32)}-`, bankIban: iban('LC', 'HEMM000100010012001200023015') },
      { bankIban: iban('MT', `${'1'.repeat(29)}A`) },
      { bankIban: iban('NO', '1234567890') },
    ];
    for (const input of cases) {
      expect(await save(owner, input), JSON.stringify(input)).toMatchObject({ ok: true });
    }
    expect((await stored(orgId)).bankIban).toHaveLength(14);
  });

  it('names the field a refusal is about; a malformed save names none', async () => {
    const { owner } = await studio();
    expect(await save(owner, { studioPhone: '+0000000' })).toEqual({ ok: false, error: 'phone_invalid', field: 'studioPhone' });
    expect(await save(owner, { bankAccountNumber: '1234' })).toEqual({ ok: false, error: 'bank_name_required', field: 'bankName' });
    expect(await save(owner, { bankName: `CIB${String.fromCodePoint(0)}` })).toEqual({ ok: false, error: 'invalid', field: 'bankName' });
    for (const input of [null, [], 'x', { changes: {} }, { revision: 'r', changes: [] }]) {
      expect(await updateClientPageDetailsCore(owner, input), JSON.stringify(input)).toEqual({ ok: false, error: 'invalid' });
    }
  });

  it('answers the database owner/admin gate (MT120) with its own code', async () => {
    const { orgId, pm } = await studio();
    // A context that CLAIMS owner for a member who is a project manager: past
    // the app's gate, refused by trg_organizations_client_page_writer.
    expect(await save(ctxFor(orgId, pm, 'owner'), { studioPhone: '01012345678' })).toEqual({
      ok: false,
      error: 'client_page_details_owner_only',
    });
    expect((await stored(orgId)).studioPhone).toBeNull();
    expect(await alertsOf(orgId)).toEqual([]);
  });
});

describe('updateClientPageDetailsCore: a save is a set of changes (F1)', () => {
  it("a stale sheet is refused and cannot put a colleague's change back", async () => {
    const { orgId, owner, owner2 } = await studio();
    await save(owner, { studioPhone: '01012345678', bankName: 'CIB', bankAccountNumber: '1111222233334444' });
    const loadedByB = clientPageRevision(await stored(orgId));
    await save(owner, { bankAccountNumber: '9999888877776666' });
    const stale = await updateClientPageDetailsCore(owner2, { revision: loadedByB, changes: { studioPhone: '01112345678' } });
    expect(stale).toEqual({ ok: false, error: 'client_page_details_stale' });
    expect(await stored(orgId)).toMatchObject({ studioPhone: '01012345678', bankAccountNumber: '9999888877776666' });
  });

  it('an unsent field stays as stored; an explicit null clears it', async () => {
    const { orgId, owner } = await studio();
    await save(owner, { studioPhone: '01012345678', instapayAddress: 'studio@instapay', bankName: 'CIB' });
    expect((await save(owner, { studioPhone: '01112345678' })).ok).toBe(true);
    expect(await stored(orgId)).toMatchObject({ studioPhone: '01112345678', instapayAddress: 'studio@instapay', bankName: 'CIB' });
    expect((await save(owner, { instapayAddress: null })).ok).toBe(true);
    expect(await stored(orgId)).toMatchObject({ instapayAddress: null, bankName: 'CIB' });
    expect((await save(owner, {})).ok).toBe(true);
    expect(await stored(orgId)).toMatchObject({ studioPhone: '01112345678', bankName: 'CIB' });
  });

  it('saving what is stored writes nothing', async () => {
    const { orgId, owner } = await studio();
    await save(owner, { studioPhone: '01012345678' });
    const audits = await raw.count('audit_log', orgId);
    expect(await save(owner, { studioPhone: '010 1234 5678' })).toMatchObject({ ok: true, data: { alert: null } });
    expect(await raw.count('audit_log', orgId)).toBe(audits);
  });
});

describe('updateClientPageDetailsCore: the audit (F4, S2)', () => {
  it('masks every number, fingerprints each value, and never writes one out', async () => {
    process.env.SHARE_LINK_SECRET = 'x'.repeat(40);
    const { orgId, owner } = await studio();
    await save(owner, { studioPhone: '01012345678', instapayAddress: 'studio@instapay', bankName: 'CIB', bankAccountNumber: '1234' });
    await save(owner, { studioPhone: '01112345678', instapayAddress: 'thief@instapay', bankAccountNumber: '9876' });
    const audits = await raw.query<{ before: Record<string, string>; after: Record<string, string> }>(
      `select before, after from public.audit_log where org_id = '${orgId}' and entity = 'organization' order by at, id`,
    );
    const last = audits.at(-1)!;
    expect(last.before.instapayAddress).toMatch(/^••••io@instapay #[0-9a-f]{8}$/);
    expect(last.after.instapayAddress).toMatch(/^••••f@instapay #[0-9a-f]{8}$/);
    expect(last.before.studioPhone.slice(0, 8)).toBe(last.after.studioPhone.slice(0, 8));
    expect(last.before.studioPhone).not.toBe(last.after.studioPhone);
    expect(last.before.bankAccountNumber).toMatch(/^•••• #[0-9a-f]{8}$/);
    expect(last.before.bankAccountNumber).not.toBe(last.after.bankAccountNumber);
    expect(JSON.stringify(audits)).not.toMatch(/01012345678|01112345678|studio@|thief@|"1234"|9876/);
  });

  it('with no secret configured, still masks (no tag) and still saves', async () => {
    const { orgId, owner } = await studio();
    expect((await save(owner, { studioPhone: '01012345678' })).ok).toBe(true);
    const [audit] = await raw.query<{ after: Record<string, string> }>(
      `select after from public.audit_log where org_id = '${orgId}' and entity = 'organization'`,
    );
    expect(audit.after).toEqual({ studioPhone: '••••5678' });
  });
});

describe('updateClientPageDetailsCore: the alert (S1, S3, S4)', () => {
  it('a phone change alerts every owner and admin, by actor id only, never a name', async () => {
    const { orgId, owner, ownerIds, admin, admin2, pm } = await studio();
    const result = await save(owner, { studioWhatsapp: '01012345678' });
    expect(result.data?.alert).toEqual({
      recipientUserIds: expect.arrayContaining([...ownerIds, admin, admin2]),
      fields: ['studioWhatsapp'],
      locale: 'ar-EG',
    });
    const alerts = await alertsOf(orgId);
    expect(new Set(alerts.map((row) => row.recipient_user_id))).toEqual(new Set([...ownerIds, admin, admin2]));
    expect(alerts.map((row) => row.recipient_user_id)).not.toContain(pm);
    for (const row of alerts) expect(row.params).toEqual({ actorUserId: owner.userId, fields: ['studioWhatsapp'] });
  });

  it('EVERY change notifies, naming its fields: a phone fix does not hide an IBAN change five minutes later', async () => {
    const { orgId, admin, ctx } = await studio();
    const actor = ctx(admin, 'admin');
    const now = new Date();
    await save(actor, { bankName: 'CIB' }, now);
    const phone = await save(actor, { studioPhone: '01012345678' }, new Date(now.getTime() + 60_000));
    const ibanChange = await save(actor, { bankIban: 'EG380019000500000000263180002' }, new Date(now.getTime() + 5 * 60_000));
    expect(phone.data?.alert?.fields).toEqual(['studioPhone']);
    expect(ibanChange.data?.alert?.fields).toEqual(['bankIban']);
    const named = (await alertsOf(orgId)).map((row) => (row.params.fields as string[]).join(','));
    // 3 saves x 4 owners/admins, each naming exactly the fields of its own save.
    expect(named.filter((fields) => fields === 'studioPhone')).toHaveLength(4);
    expect(named.filter((fields) => fields === 'bankIban')).toHaveLength(4);
    expect(named).toHaveLength(12);
  });

  it('the same actor repeating the same fields within the hour: notified again, not emailed again', async () => {
    const { orgId, owner } = await studio();
    const now = new Date();
    expect((await save(owner, { bankName: 'CIB' }, now)).data?.alert).not.toBeNull();
    expect(await save(owner, { bankName: 'NBE' }, now)).toMatchObject({ ok: true, data: { alert: null } });
    expect(await alertsOf(orgId)).toHaveLength(8);
    // A different field set, or the next hour, emails again.
    expect((await save(owner, { bankName: 'QNB', bankAccountHolder: 'Studio' }, now)).data?.alert).not.toBeNull();
    expect((await save(owner, { bankName: 'CIB' }, new Date(now.getTime() + 60 * 60 * 1000))).data?.alert).not.toBeNull();
  });

  it('past three email batches in an hour the alert is in-app only, never dropped', async () => {
    const { orgId, owner, owner2, admin, admin2, ctx } = await studio();
    const now = new Date();
    const results = [];
    for (const [actor, bankName] of [[owner, 'CIB'], [owner2, 'QNB'], [ctx(admin, 'admin'), 'HSBC'], [ctx(admin2, 'admin'), 'ADIB']] as const) {
      results.push(await save(actor, { bankName }, now));
    }
    expect(results.map((result) => result.data?.alert !== null)).toEqual([true, true, true, false]);
    expect(await alertsOf(orgId)).toHaveLength(16);
    const audits = await raw.query(`select id from public.audit_log where org_id = '${orgId}' and entity = 'organization'`);
    expect(audits).toHaveLength(4);
  });
});
