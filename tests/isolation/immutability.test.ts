// Proof for the enforce_immutable_when() trigger factory (SQLSTATE MT100).
// Uses a throwaway probe table over the postgres (BYPASSRLS) connection.
import { createSql } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const T = '_immut_probe';
let pg: ReturnType<typeof createSql>;

async function insert(status: string, data = 'orig'): Promise<string> {
  const rows = await pg.unsafe(
    `insert into public.${T} (org_id, status, data)
     values (gen_random_uuid(), '${status}', '${data}') returning id`,
  );
  return (rows as unknown as Array<{ id: string }>)[0].id;
}

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  pg = createSql(DATABASE_URL, { max: 1, prepare: false });
  await pg.unsafe(`drop table if exists public.${T}`);
  await pg.unsafe(
    `create table public.${T} (
       id uuid primary key default gen_random_uuid(),
       org_id uuid not null,
       status text not null default 'draft',
       data text,
       updated_at timestamptz not null default now()
     )`,
  );
  // Locked status = issued; the only allowed transition = credited.
  await pg.unsafe(
    `create trigger trg_immut before update or delete on public.${T}
     for each row
     execute function public.enforce_immutable_when('status','issued','credited')`,
  );
});

afterAll(async () => {
  if (pg) {
    await pg.unsafe(`drop table if exists public.${T}`);
    await pg.end();
  }
});

describe('enforce_immutable_when (MT100)', () => {
  it('a non-locked (draft) row is freely mutable and deletable', async () => {
    const id = await insert('draft');
    await expect(
      pg.unsafe(`update public.${T} set data='edited' where id='${id}'`),
    ).resolves.toBeDefined();
    await expect(
      pg.unsafe(`delete from public.${T} where id='${id}'`),
    ).resolves.toBeDefined();
  });

  it('a locked (issued) row: UPDATE of another column raises MT100', async () => {
    const id = await insert('issued');
    await expect(
      pg.unsafe(`update public.${T} set data='hack' where id='${id}'`),
    ).rejects.toMatchObject({ code: 'MT100' });
  });

  it('a locked (issued) row: DELETE raises MT100', async () => {
    const id = await insert('issued');
    await expect(
      pg.unsafe(`delete from public.${T} where id='${id}'`),
    ).rejects.toMatchObject({ code: 'MT100' });
  });

  it('a locked (issued) row: the allowed status->credited transition succeeds', async () => {
    const id = await insert('issued');
    await pg.unsafe(
      `update public.${T} set status='credited', updated_at=now() where id='${id}'`,
    );
    const rows = await pg.unsafe(
      `select status from public.${T} where id='${id}'`,
    );
    expect((rows as unknown as Array<{ status: string }>)[0].status).toBe(
      'credited',
    );
  });

  it('a locked row: transition to a non-allowed target raises MT100', async () => {
    const id = await insert('issued');
    await expect(
      pg.unsafe(`update public.${T} set status='superseded' where id='${id}'`),
    ).rejects.toMatchObject({ code: 'MT100' });
  });

  it('a locked row: allowed transition that ALSO changes another column raises MT100', async () => {
    const id = await insert('issued');
    await expect(
      pg.unsafe(
        `update public.${T} set status='credited', data='changed' where id='${id}'`,
      ),
    ).rejects.toMatchObject({ code: 'MT100' });
  });
});
