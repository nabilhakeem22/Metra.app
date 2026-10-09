import { createHash, randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GET as proposalsList } from '@/app/api/v1/proposals/route';
import { GET as proposalDetail } from '@/app/api/v1/proposals/[id]/route';
import { listProposalsPage } from '@/lib/api/queries';
import { createProposalCore } from '@/lib/proposals/core';
import { boqProposalWith, rawEngagement, seedBoqOrg, TWO_SECTIONS } from './boq-proposal-fixture';
import { closeFixture, raw, teardown } from './fixture';

// Where a BOQ working copy must NOT show up as a quote: the Public API v1 (its
// proposals are quotes, AC23). The onboarding "built a proposal" tick (F6) is
// gone: Round C's checklist leads to the first delivery, not to a quotation.
vi.mock('@/lib/pdf/render', () => ({
  renderPdf: () => Promise.reject(new Error('no renderer in the dbtest runner')),
}));

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const BASE = 'https://api.test/api/v1';

/** A live API key for `createdBy`, inserted raw (mirrors api-isolation). */
async function apiKey(orgId: string, createdBy: string): Promise<string> {
  const rawKey = `mtk_${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(rawKey).digest('hex');
  await raw.query(
    `insert into public.api_keys (id, org_id, label, token_hash, token_prefix, created_by)
     values (gen_random_uuid(), '${orgId}', 'boq-surfaces', '${hash}',
             '${rawKey.slice(0, 12)}', '${createdBy}')`,
  );
  return rawKey;
}

const bearer = (url: string, key: string) =>
  new Request(url, { headers: { authorization: `Bearer ${key}` } });

describe('a BOQ working copy is not a quote to the outside (AC23)', () => {
  it('is absent from listProposalsPage and the v1 list, and 404s on the v1 detail', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const boqProposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    const quote = await createProposalCore(org.ctx, {
      clientId: org.clientId,
      projectId: org.projectId,
    });
    const quoteId = (quote as { data?: string }).data!;

    const page = await listProposalsPage(org.ctx, { limit: 50, cursor: null });
    expect(page.map((row) => row.id)).toEqual([quoteId]);

    const key = await apiKey(org.orgId, org.ctx.userId);
    const listed = await proposalsList(bearer(`${BASE}/proposals`, key));
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { data: { id: string }[] };
    expect(body.data.map((row) => row.id)).toEqual([quoteId]);

    const detail = await proposalDetail(bearer(`${BASE}/proposals/${boqProposalId}`, key), {
      params: Promise.resolve({ id: boqProposalId }),
    });
    expect(detail.status).toBe(404);
    const quoteDetail = await proposalDetail(bearer(`${BASE}/proposals/${quoteId}`, key), {
      params: Promise.resolve({ id: quoteId }),
    });
    expect(quoteDetail.status).toBe(200);
  });
});
