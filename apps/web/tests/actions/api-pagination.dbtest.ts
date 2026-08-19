import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as clientsList } from '@/app/api/v1/clients/route';
import { GET as costItemsList } from '@/app/api/v1/cost-items/route';
import { mintApiKeyCore } from '@/lib/api-keys/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// F1/F2 regression: rows sharing an exact millisecond (with non-zero MICROSECONDS)
// must page to exhaustion with no skip/dup (F1); malformed cursors must 400 (F2).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

// Every row shares this instant to the MICROSECOND — the exact case that a
// millisecond-truncated cursor silently dropped.
const SHARED_TS = '2026-06-01 12:00:00.123456+00';
const ROW_COUNT = 6;

function bearer(url: string, key: string): Request {
  return new Request(url, { headers: { authorization: `Bearer ${key}` } });
}

function asJson<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

interface ListBody {
  data: { id: string }[];
  next_cursor: string | null;
}

let orgId: string;
let ownerKey: string;
let clientIds: string[];
let costItemIds: string[];

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  orgIds.push(orgId);
  const ownerCtx = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  ownerKey = (await mintApiKeyCore(ownerCtx, { label: 'Pager' })).data!.rawKey;

  const sectionId = await raw.sectionId(orgId);
  clientIds = [];
  costItemIds = [];
  for (let i = 0; i < ROW_COUNT; i += 1) {
    const cId = randomUUID();
    clientIds.push(cId);
    await raw.query(
      `insert into public.clients (id, org_id, created_at, updated_at, name_en)
       values ('${cId}', '${orgId}', '${SHARED_TS}', '${SHARED_TS}', 'Pager client ${i}')`,
    );
    const kId = randomUUID();
    costItemIds.push(kId);
    await raw.query(
      `insert into public.cost_items
         (id, org_id, created_at, updated_at, code, name_en, section_id, unit)
       values ('${kId}', '${orgId}', '${SHARED_TS}', '${SHARED_TS}',
               'PG-${i}-${kId.slice(0, 8)}', 'Pager item ${i}', '${sectionId}', 'sqm')`,
    );
  }
}, 60000);

const BASE = 'https://api.test/api/v1';

async function pageToExhaustion(
  route: (req: Request) => Promise<Response>,
  path: string,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const url = cursor
      ? `${BASE}/${path}?limit=2&cursor=${encodeURIComponent(cursor)}`
      : `${BASE}/${path}?limit=2`;
    const res = await route(bearer(url, ownerKey));
    expect(res.status).toBe(200);
    const body = await asJson<ListBody>(res);
    for (const row of body.data) seen.push(row.id);
    cursor = body.next_cursor;
    if (!cursor) break;
  }
  return seen;
}

describe('F1 — same-microsecond rows page to exhaustion (no skip, no dup)', () => {
  it('clients: all 6 identical-timestamp rows returned exactly once', async () => {
    const seen = await pageToExhaustion(clientsList, 'clients');
    expect(seen).toHaveLength(ROW_COUNT); // no dup
    expect(new Set(seen).size).toBe(ROW_COUNT); // no dup
    for (const id of clientIds) expect(seen).toContain(id); // no skip
  });

  it('cost-items: all 6 identical-timestamp rows returned exactly once', async () => {
    const seen = await pageToExhaustion(costItemsList, 'cost-items');
    expect(seen).toHaveLength(ROW_COUNT);
    expect(new Set(seen).size).toBe(ROW_COUNT);
    for (const id of costItemIds) expect(seen).toContain(id);
  });
});

describe('F2 — crafted cursor -> 400 invalid-cursor, never 500', () => {
  const uuid = '00000000-0000-4000-8000-0000000000a1';

  function craft(ts: string): string {
    return Buffer.from(JSON.stringify({ t: ts, i: uuid }), 'utf8').toString(
      'base64url',
    );
  }

  it('valid-JS-but-not-our-format timestamps are 400, not 500', async () => {
    for (const ts of ['2026', '0', '2026-08', '2026-08-19T10:00:00.000Z']) {
      const res = await clientsList(
        bearer(`${BASE}/clients?cursor=${encodeURIComponent(craft(ts))}`, ownerKey),
      );
      expect(res.status, ts).toBe(400);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
      const body = await asJson<{ type: string }>(res);
      expect(body.type).toContain('/problems/invalid-cursor');
    }
  });
});
