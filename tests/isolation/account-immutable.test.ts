// S1 (Epic A2) — organizations.account_id is immutable ONCE SET. Proves the
// enforce_account_id_immutable() BEFORE UPDATE trigger (SQLSTATE MT110):
//   * re-pointing a linked org to a different account raises MT110;
//   * a no-account-column update (name_en) on a linked org succeeds;
//   * a NULL -> non-null link on an unlinked org is still permitted.
// Uses throwaway probe accounts/orgs over the postgres (BYPASSRLS) connection so
// it never touches seeded data. Requires: migrations applied, RLS applied.
import { randomUUID } from 'node:crypto';
import { createSql } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
let pg: ReturnType<typeof createSql>;

const ACCOUNT_X = randomUUID();
const ACCOUNT_Y = randomUUID();
const ORG_LINKED = randomUUID();
const ORG_UNLINKED = randomUUID();

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  pg = createSql(DATABASE_URL, { max: 1, prepare: false });

  // Two probe accounts; one org linked to X, one org still unlinked (NULL).
  await pg.unsafe(
    `insert into public.accounts (id, name_en) values
       ('${ACCOUNT_X}', 'Probe account X'),
       ('${ACCOUNT_Y}', 'Probe account Y')`,
  );
  await pg.unsafe(
    `insert into public.organizations (id, account_id, name_en)
     values ('${ORG_LINKED}', '${ACCOUNT_X}', 'Linked probe org')`,
  );
  await pg.unsafe(
    `insert into public.organizations (id, name_en)
     values ('${ORG_UNLINKED}', 'Unlinked probe org')`,
  );
});

afterAll(async () => {
  if (pg) {
    await pg.unsafe(
      `delete from public.organizations where id in ('${ORG_LINKED}', '${ORG_UNLINKED}')`,
    );
    await pg.unsafe(
      `delete from public.accounts where id in ('${ACCOUNT_X}', '${ACCOUNT_Y}')`,
    );
    await pg.end();
  }
});

describe('organizations.account_id immutability (MT110)', () => {
  it('re-pointing a linked org to a different account raises MT110', async () => {
    await expect(
      pg.unsafe(
        `update public.organizations set account_id = '${ACCOUNT_Y}' where id = '${ORG_LINKED}'`,
      ),
    ).rejects.toMatchObject({ code: 'MT110' });

    // The link is untouched.
    const rows = await pg.unsafe(
      `select account_id from public.organizations where id = '${ORG_LINKED}'`,
    );
    expect(
      (rows as unknown as Array<{ account_id: string }>)[0].account_id,
    ).toBe(ACCOUNT_X);
  });

  it('unlinking a linked org (account_id -> NULL) raises MT110', async () => {
    await expect(
      pg.unsafe(
        `update public.organizations set account_id = NULL where id = '${ORG_LINKED}'`,
      ),
    ).rejects.toMatchObject({ code: 'MT110' });
  });

  it('a non-account update (name_en) on a linked org succeeds', async () => {
    await pg.unsafe(
      `update public.organizations set name_en = 'Renamed linked org' where id = '${ORG_LINKED}'`,
    );
    const rows = await pg.unsafe(
      `select name_en, account_id from public.organizations where id = '${ORG_LINKED}'`,
    );
    const row = (rows as unknown as Array<{
      name_en: string;
      account_id: string;
    }>)[0];
    expect(row.name_en).toBe('Renamed linked org');
    expect(row.account_id).toBe(ACCOUNT_X);
  });

  it('a NULL -> non-null link on an unlinked org is still permitted', async () => {
    await pg.unsafe(
      `update public.organizations set account_id = '${ACCOUNT_Y}' where id = '${ORG_UNLINKED}'`,
    );
    const rows = await pg.unsafe(
      `select account_id from public.organizations where id = '${ORG_UNLINKED}'`,
    );
    expect(
      (rows as unknown as Array<{ account_id: string }>)[0].account_id,
    ).toBe(ACCOUNT_Y);
  });
});
