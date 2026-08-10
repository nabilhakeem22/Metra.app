// DB proof for the composite same-org FK (mirrors sameOrgFk's output). The
// composite (org_id, parent_id) -> parent(org_id, id) makes a cross-org parent
// reference impossible at the database (SQLSTATE 23503). Runs over the postgres
// (BYPASSRLS) connection on throwaway tables.
import { randomUUID } from 'node:crypto';
import { createSql } from '@metra/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const P = '_cfk_parent';
const C = '_cfk_child';
let pg: ReturnType<typeof createSql>;

const orgA = randomUUID();
const orgB = randomUUID();
const parentA = randomUUID();
const parentB = randomUUID();

beforeAll(async () => {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  pg = createSql(DATABASE_URL, { max: 1, prepare: false });
  await pg.unsafe(`drop table if exists public.${C}`);
  await pg.unsafe(`drop table if exists public.${P}`);
  await pg.unsafe(
    `create table public.${P} (
       id uuid primary key default gen_random_uuid(),
       org_id uuid not null,
       constraint ${P}_org_id_id_unique unique (org_id, id)
     )`,
  );
  await pg.unsafe(
    `create table public.${C} (
       id uuid primary key default gen_random_uuid(),
       org_id uuid not null,
       parent_id uuid,
       constraint ${C}_parent_same_org_fk
         foreign key (org_id, parent_id) references public.${P} (org_id, id)
     )`,
  );
  await pg.unsafe(`create index ${C}_parent_idx on public.${C} (org_id, parent_id)`);

  await pg.unsafe(
    `insert into public.${P} (id, org_id) values ('${parentA}', '${orgA}')`,
  );
  await pg.unsafe(
    `insert into public.${P} (id, org_id) values ('${parentB}', '${orgB}')`,
  );
});

afterAll(async () => {
  if (pg) {
    await pg.unsafe(`drop table if exists public.${C}`);
    await pg.unsafe(`drop table if exists public.${P}`);
    await pg.end();
  }
});

describe('composite same-org FK', () => {
  it('accepts a child whose parent is in the SAME org', async () => {
    await expect(
      pg.unsafe(
        `insert into public.${C} (org_id, parent_id) values ('${orgA}', '${parentA}')`,
      ),
    ).resolves.toBeDefined();
  });

  it('REJECTS a cross-org parent_id (SQLSTATE 23503)', async () => {
    // orgA child pointing at orgB's parent -> (orgA, parentB) has no match.
    await expect(
      pg.unsafe(
        `insert into public.${C} (org_id, parent_id) values ('${orgA}', '${parentB}')`,
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('ships the (org_id, <name>_id) index', async () => {
    const rows = await pg.unsafe(
      `select indexname from pg_indexes
       where schemaname='public' and indexname='${C}_parent_idx'`,
    );
    expect((rows as unknown as unknown[]).length).toBe(1);
  });
});
