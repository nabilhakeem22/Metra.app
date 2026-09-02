import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as clientsList } from '@/app/api/v1/clients/route';
import { GET as clientDetail } from '@/app/api/v1/clients/[id]/route';
import { GET as costItemsList } from '@/app/api/v1/cost-items/route';
import { GET as costItemDetail } from '@/app/api/v1/cost-items/[id]/route';
import { GET as projectsList } from '@/app/api/v1/projects/route';
import { GET as proposalsList } from '@/app/api/v1/proposals/route';
import { GET as proposalDetail } from '@/app/api/v1/proposals/[id]/route';
import { mintApiKeyCore, revokeApiKeyCore } from '@/lib/api-keys/core';
import { handleApiRequest } from '@/lib/api/pipeline';
import { createClientCore } from '@/lib/clients/core';
import { createCostItemCore } from '@/lib/price-book/core';
import { createProjectCore } from '@/lib/projects/core';
import { createProposalCore, saveProposalDraftCore } from '@/lib/proposals/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

function bearer(url: string, key?: string): Request {
  return new Request(url, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
}

function asJson<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

interface ListBody {
  data: { id: string }[];
  next_cursor: string | null;
}
interface ProblemBody {
  type: string;
}

async function insertRawKey(
  orgId: string,
  createdBy: string,
  label: string,
  opts: { expiresAt?: string; revokedAt?: string } = {},
): Promise<string> {
  // 32 bytes base64url = 43 chars -> `mtk_` + 43 = 47, matching the strict gate.
  const rawKey = `mtk_${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(rawKey).digest('hex');
  const cols = ['id', 'org_id', 'label', 'token_hash', 'token_prefix', 'created_by'];
  const vals = [
    'gen_random_uuid()',
    `'${orgId}'`,
    `'${label}'`,
    `'${hash}'`,
    `'${rawKey.slice(0, 12)}'`,
    `'${createdBy}'`,
  ];
  if (opts.expiresAt) {
    cols.push('expires_at');
    vals.push(`'${opts.expiresAt}'`);
  }
  if (opts.revokedAt) {
    cols.push('revoked_at');
    vals.push(`'${opts.revokedAt}'`);
  }
  await raw.query(
    `insert into public.api_keys (${cols.join(', ')}) values (${vals.join(', ')})`,
  );
  return rawKey;
}

interface OrgFixture {
  orgId: string;
  ownerId: string;
  pmId: string;
  viewerId: string;
  removableId: string;
  clientId: string;
  projectId: string;
  proposalId: string;
  costItemId: string;
  ownerKey: string;
  viewerKey: string;
}

async function buildOrg(): Promise<OrgFixture> {
  const seeded = await seedOrg({
    owners: 1,
    members: [
      { role: 'project_manager' },
      { role: 'viewer' },
      { role: 'viewer' },
    ],
  });
  orgIds.push(seeded.orgId);
  const ownerId = seeded.ownerIds[0];
  const [pmId, viewerId, removableId] = seeded.memberIds;
  const ownerCtx = ctxFor(seeded.orgId, ownerId, 'owner');

  const client = await createClientCore(ownerCtx, {
    phone: '01000000000',
    nameEn: 'API Client',
    city: 'Cairo',
  });
  const clientId = client.data!;

  const project = await createProjectCore(ownerCtx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
    code: `API-${randomBytes(3).toString('hex')}`,
    nameEn: 'API Project',
    clientId,
    status: 'active',
  });
  const projectId = project.data!;

  const proposal = await createProposalCore(ownerCtx, { clientId, projectId });
  const proposalId = (proposal as { data?: string }).data!;
  // A costed line so the owner detail carries unit_cost/margin.
  await saveProposalDraftCore(ownerCtx, {
    id: proposalId,
    sections: [
      {
        titleEn: 'Works',
        lines: [
          {
            descriptionEn: 'Line',
            qty: '1',
            unit: 'lump_sum',
            unitCost: '100',
            unitPrice: '150',
          },
        ],
      },
    ],
  });

  const costItemCode = `CI-${randomBytes(3).toString('hex')}`;
  await createCostItemCore(ownerCtx, {
    code: costItemCode,
    nameEn: 'Cost item',
    sectionId: await raw.sectionId(seeded.orgId),
    unit: 'sqm',
    defaultUnitCost: '80',
    defaultUnitPrice: '120',
  });
  const [ci] = await raw.query<{ id: string }>(
    `select id from public.cost_items where org_id = '${seeded.orgId}' and code = '${costItemCode}'`,
  );

  const minted = await mintApiKeyCore(ownerCtx, { label: 'Owner key' });
  const ownerKey = minted.data!.rawKey;
  // A key whose creator is a viewer (canSeeMargin false) — the mint gate is
  // owner/admin, so seed this one directly to exercise the live-role resolver.
  const viewerKey = await insertRawKey(seeded.orgId, viewerId, 'Viewer key');

  return {
    orgId: seeded.orgId,
    ownerId,
    pmId,
    viewerId,
    removableId,
    clientId,
    projectId,
    proposalId,
    costItemId: ci.id,
    ownerKey,
    viewerKey,
  };
}

let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  a = await buildOrg();
  b = await buildOrg();
}, 60000);

const BASE = 'https://api.test/api/v1';

describe('AC1 — org isolation across all 4 resources', () => {
  it('clients list under org-A key never returns an org-B row', async () => {
    const res = await clientsList(bearer(`${BASE}/clients`, a.ownerKey));
    expect(res.status).toBe(200);
    const body = await asJson<ListBody>(res);
    const ids = body.data.map((r) => r.id);
    expect(ids).toContain(a.clientId);
    expect(ids).not.toContain(b.clientId);
  });

  it('projects list under org-A key never returns an org-B row', async () => {
    const res = await projectsList(bearer(`${BASE}/projects`, a.ownerKey));
    const body = await asJson<ListBody>(res);
    const ids = body.data.map((r) => r.id);
    expect(ids).toContain(a.projectId);
    expect(ids).not.toContain(b.projectId);
  });

  it('proposals list under org-A key never returns an org-B row', async () => {
    const res = await proposalsList(bearer(`${BASE}/proposals`, a.ownerKey));
    const body = await asJson<ListBody>(res);
    const ids = body.data.map((r) => r.id);
    expect(ids).toContain(a.proposalId);
    expect(ids).not.toContain(b.proposalId);
  });

  it('cost-items list under org-A key never returns an org-B row', async () => {
    const res = await costItemsList(bearer(`${BASE}/cost-items`, a.ownerKey));
    const body = await asJson<ListBody>(res);
    const ids = body.data.map((r) => r.id);
    expect(ids).toContain(a.costItemId);
    expect(ids).not.toContain(b.costItemId);
  });
});

describe('AC2 — foreign detail id is 404 problem+json (not 403, not the row)', () => {
  it('GET /clients/{orgB_id} under org-A key -> 404 problem+json', async () => {
    const res = await clientDetail(
      bearer(`${BASE}/clients/${b.clientId}`, a.ownerKey),
      { params: Promise.resolve({ id: b.clientId }) },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = await asJson<ProblemBody & { name_en?: string }>(res);
    expect(body.type).toContain('/problems/not-found');
    expect(body).not.toHaveProperty('name_en');
  });

  it('own detail id resolves 200 (control)', async () => {
    const res = await clientDetail(
      bearer(`${BASE}/clients/${a.clientId}`, a.ownerKey),
      { params: Promise.resolve({ id: a.clientId }) },
    );
    expect(res.status).toBe(200);
    expect((await asJson<{ id: string }>(res)).id).toBe(a.clientId);
  });
});

describe('AC3 — no/malformed/unknown/revoked/expired key -> 401 problem+json', () => {
  async function expect401(res: Response) {
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect((await asJson<ProblemBody>(res)).type).toContain(
      '/problems/unauthorized',
    );
  }

  it('no key', async () => {
    await expect401(await clientsList(bearer(`${BASE}/clients`)));
  });

  it('malformed key (no mtk_ prefix)', async () => {
    await expect401(await clientsList(bearer(`${BASE}/clients`, 'garbage')));
  });

  it('unknown key (well-formed but not in the DB)', async () => {
    // Passes the strict format gate, so this exercises the DB miss -> 401.
    await expect401(
      await clientsList(bearer(`${BASE}/clients`, `mtk_${'A'.repeat(43)}`)),
    );
  });

  it('malformed key (right prefix, wrong shape) -> 401', async () => {
    await expect401(
      await clientsList(bearer(`${BASE}/clients`, 'mtk_too_short')),
    );
  });

  it('revoked key', async () => {
    const ownerCtx = ctxFor(a.orgId, a.ownerId, 'owner');
    const minted = await mintApiKeyCore(ownerCtx, { label: 'To revoke' });
    // Find the key id and revoke it.
    const [row] = await raw.query<{ id: string }>(
      `select id from public.api_keys where org_id = '${a.orgId}' and label = 'To revoke' limit 1`,
    );
    await revokeApiKeyCore(ownerCtx, row.id);
    await expect401(
      await clientsList(bearer(`${BASE}/clients`, minted.data!.rawKey)),
    );
  });

  it('expired key', async () => {
    const expired = await insertRawKey(a.orgId, a.ownerId, 'Expired', {
      expiresAt: '2000-01-01T00:00:00Z',
    });
    await expect401(await clientsList(bearer(`${BASE}/clients`, expired)));
  });
});

describe('AC5 — live-role cost/margin gating', () => {
  it('owner key exposes proposal-line unit_cost + cost-item unit_cost', async () => {
    const proposal = await proposalDetail(
      bearer(`${BASE}/proposals/${a.proposalId}`, a.ownerKey),
      { params: Promise.resolve({ id: a.proposalId }) },
    );
    const pBody = await asJson<{
      total_cost?: string;
      sections: { lines: Record<string, unknown>[] }[];
    }>(proposal);
    const line = pBody.sections[0].lines[0];
    expect(line).toHaveProperty('unit_cost');
    expect(line).toHaveProperty('line_margin');
    expect(pBody).toHaveProperty('total_cost');

    const costItem = await costItemDetail(
      bearer(`${BASE}/cost-items/${a.costItemId}`, a.ownerKey),
      { params: Promise.resolve({ id: a.costItemId }) },
    );
    expect(await asJson<Record<string, unknown>>(costItem)).toHaveProperty(
      'default_unit_cost',
    );
  });

  it('viewer key strips every cost/margin key', async () => {
    const proposal = await proposalDetail(
      bearer(`${BASE}/proposals/${a.proposalId}`, a.viewerKey),
      { params: Promise.resolve({ id: a.proposalId }) },
    );
    const pBody = await asJson<{
      total_cost?: string;
      total_margin?: string;
      sections: { lines: Record<string, unknown>[] }[];
    }>(proposal);
    const line = pBody.sections[0].lines[0];
    expect(line).not.toHaveProperty('unit_cost');
    expect(line).not.toHaveProperty('line_cost');
    expect(line).not.toHaveProperty('line_margin');
    expect(pBody).not.toHaveProperty('total_cost');
    expect(pBody).not.toHaveProperty('total_margin');

    const costItem = await costItemDetail(
      bearer(`${BASE}/cost-items/${a.costItemId}`, a.viewerKey),
      { params: Promise.resolve({ id: a.costItemId }) },
    );
    expect(await asJson<Record<string, unknown>>(costItem)).not.toHaveProperty(
      'default_unit_cost',
    );
  });
});

describe('AC6 — limit clamp + cursor round-trip', () => {
  it('limit=500 is clamped to 100', async () => {
    const res = await clientsList(bearer(`${BASE}/clients?limit=500`, a.ownerKey));
    const body = await asJson<ListBody>(res);
    expect(body.data.length).toBeLessThanOrEqual(100);
  });

  it('next_cursor round-trips with no dup/gap', async () => {
    const ownerCtx = ctxFor(a.orgId, a.ownerId, 'owner');
    // Ensure at least 3 clients so paging is non-trivial.
    await createClientCore(ownerCtx, { phone: '01000000000', nameEn: 'Client 2' });
    await createClientCore(ownerCtx, { phone: '01000000000', nameEn: 'Client 3' });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const url: string = cursor
        ? `${BASE}/clients?limit=1&cursor=${encodeURIComponent(cursor)}`
        : `${BASE}/clients?limit=1`;
      const res: Response = await clientsList(bearer(url, a.ownerKey));
      const body: ListBody = await asJson<ListBody>(res);
      for (const row of body.data) seen.push(row.id);
      cursor = body.next_cursor;
      if (!cursor) break;
    }
    // No duplicates across pages.
    expect(new Set(seen).size).toBe(seen.length);
    // Every org-A client was seen exactly once (no gap).
    expect(seen).toContain(a.clientId);
  });

  it('corrupt cursor -> 400 problem+json', async () => {
    const res = await clientsList(
      bearer(`${BASE}/clients?cursor=not-a-real-cursor`, a.ownerKey),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect((await asJson<ProblemBody>(res)).type).toContain(
      '/problems/invalid-cursor',
    );
  });
});

describe('AC7 — over-rate -> 429 + Retry-After, no handler/data work', () => {
  it('rejects with 429 before the handler runs', async () => {
    let handlerCalls = 0;
    const res = await handleApiRequest(
      bearer(`${BASE}/clients`, a.ownerKey),
      async () => {
        handlerCalls += 1;
        return { data: [] };
      },
      { rateLimiter: async () => ({ allowed: false, retryAfterSeconds: 60 }) },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    // The handler (the only path that touches business data) never ran.
    expect(handlerCalls).toBe(0);
  });
});

describe('AC8 — creator removed from org -> 401 on next request', () => {
  it('a live key stops resolving once its creator loses membership', async () => {
    const key = await insertRawKey(a.orgId, a.removableId, 'Removable');
    // Resolves fine while the creator is a member.
    const before = await clientsList(bearer(`${BASE}/clients`, key));
    expect(before.status).toBe(200);

    // Remove the creator's membership (the SDF JOINs memberships).
    await raw.query(
      `delete from public.memberships where org_id = '${a.orgId}' and user_id = '${a.removableId}'`,
    );

    const after = await clientsList(bearer(`${BASE}/clients`, key));
    expect(after.status).toBe(401);
  });
});
