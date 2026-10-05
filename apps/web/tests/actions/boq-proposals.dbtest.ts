import { sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { openBoqProposalCore } from '@/lib/boq-proposals/core/open';
import { sendProposalAsBoqCore } from '@/lib/boq-proposals/core/send';
import {
  createProposalCore,
  deleteDraftProposalCore,
  saveProposalDraftCore,
  sendProposalCore,
} from '@/lib/proposals/core';
import {
  boqProposalWith,
  rawEngagement,
  seedBoqOrg,
  TWO_SECTIONS,
} from './boq-proposal-fixture';
import { closeFixture, raw, teardown } from './fixture';

// The BOQ working copy, before anything is sent: opening it, saving it, and the
// four locks that keep it off the quote lifecycle (the send core, the delete
// core, the admission UPDATE and the database CHECKs). No Chromium in this
// runner: the render is stubbed to fail, and every case here is refused or
// finished before it would be reached.
vi.mock('@/lib/pdf/render', () => ({
  renderPdf: () => Promise.reject(new Error('no renderer in the dbtest runner')),
}));

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function boqProposalRows(engagementId: string) {
  return raw.query<{
    id: string;
    kind: string;
    status: string;
    client_id: string;
    project_id: string;
    tax_rate: string;
    supervision_pct: string;
    token_hash: string | null;
    subtotal: string;
    discount_amount: string;
    total: string;
  }>(
    `select id, kind, status, client_id, project_id, tax_rate::text, supervision_pct::text,
            token_hash, subtotal::text, discount_amount::text, total::text
       from public.proposals where engagement_id = '${engagementId}'`,
  );
}

async function refusalSqlstate(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return sqlstateOf(error) ?? 'unknown';
  }
}

describe('openBoqProposalCore (AC1-3)', () => {
  it('creates one unpriced BOQ draft on the engagement, and returns it again', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);

    const first = await openBoqProposalCore(org.ctx, { engagementId });
    expect(first.ok).toBe(true);
    const rows = await boqProposalRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.data,
      kind: 'boq',
      status: 'draft',
      client_id: org.clientId,
      project_id: org.projectId,
      token_hash: null,
    });
    expect(Number(rows[0].tax_rate)).toBe(0);
    expect(Number(rows[0].supervision_pct)).toBe(0);

    const second = await openBoqProposalCore(org.pmCtx, { engagementId });
    expect(second).toEqual({ ok: true, data: first.data });
    expect(await boqProposalRows(engagementId)).toHaveLength(1);
  });

  it('two concurrent opens leave exactly one BOQ proposal', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const [a, b] = await Promise.all([
      openBoqProposalCore(org.ctx, { engagementId }),
      openBoqProposalCore(org.pmCtx, { engagementId }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.data).toBe(b.data);
    expect(await boqProposalRows(engagementId)).toHaveLength(1);
  });

  it('refuses a foreign engagement, an abandoned one, and roles without boq_build create', async () => {
    const org = await seedBoqOrg(orgIds);
    const other = await seedBoqOrg(orgIds);
    const foreign = await rawEngagement(other);
    expect(await openBoqProposalCore(org.ctx, { engagementId: foreign })).toEqual({
      ok: false,
      error: 'engagement_not_found',
    });

    const abandoned = await rawEngagement(org, 'abandoned');
    expect(await openBoqProposalCore(org.ctx, { engagementId: abandoned })).toEqual({
      ok: false,
      error: 'engagement_not_active',
    });

    const engagementId = await rawEngagement(org);
    for (const ctx of [org.viewerCtx, org.siteCtx]) {
      expect(await openBoqProposalCore(ctx, { engagementId })).toEqual({
        ok: false,
        error: 'forbidden',
      });
    }
    expect(await boqProposalRows(engagementId)).toHaveLength(0);
  });
});

describe('the quote lifecycle cannot reach a BOQ proposal (AC4-7)', () => {
  it('a draft save forces VAT and supervision to 0 whatever is sent', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS, {
      discountPct: '5',
      taxRate: '14',
      supervisionPct: '10',
    });
    const [row] = await boqProposalRows(engagementId);
    expect(Number(row.tax_rate)).toBe(0);
    expect(Number(row.supervision_pct)).toBe(0);
    expect(Number(row.subtotal)).toBeGreaterThan(0);
    expect(row.total).toBe(
      (await raw.query<{ t: string }>(
        `select (subtotal - discount_amount)::text as t from public.proposals where id = '${row.id}'`,
      ))[0].t,
    );
  });

  it('the quote send refuses it by name and leaves it a draft with no token', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const id = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    expect(await sendProposalCore(org.ctx, { id })).toEqual({
      ok: false,
      error: 'proposal_is_boq',
    });
    const [row] = await boqProposalRows(engagementId);
    expect(row.status).toBe('draft');
    expect(row.token_hash).toBeNull();
  });

  it('the draft delete refuses it and the row survives', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const id = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    expect(await deleteDraftProposalCore(org.ctx, { id })).toEqual({
      ok: false,
      error: 'proposal_is_boq',
    });
    expect(await boqProposalRows(engagementId)).toHaveLength(1);
  });

  it('the database CHECKs refuse every bypass on the owner connection (23514)', async () => {
    const org = await seedBoqOrg(orgIds);
    const bare = await rawEngagement(org, 'abandoned');
    const engagementId = await rawEngagement(org);
    const id = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);

    expect(
      await refusalSqlstate(() =>
        raw.query(`update public.proposals set status = 'sent' where id = '${id}'`),
      ),
    ).toBe('23514');
    expect(
      await refusalSqlstate(() =>
        raw.query(`update public.proposals set token_hash = 'x' where id = '${id}'`),
      ),
    ).toBe('23514');
    expect(
      await refusalSqlstate(() =>
        raw.query(
          `insert into public.proposals (org_id, number, title_en, client_id, project_id, kind, tax_rate)
           values ('${org.orgId}', 9001, 'B', '${org.clientId}', '${org.projectId}', 'boq', 0)`,
        ),
      ),
    ).toBe('23514');
    expect(
      await refusalSqlstate(() =>
        raw.query(
          `insert into public.proposals (org_id, number, title_en, client_id, project_id, engagement_id)
           values ('${org.orgId}', 9002, 'Q', '${org.clientId}', '${org.projectId}', '${bare}')`,
        ),
      ),
    ).toBe('23514');
  });
});

describe('sendProposalAsBoqCore refusals before any render (AC13)', () => {
  it('line_required with no lines, invalid for a quote, forbidden for a viewer', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const empty = await openBoqProposalCore(org.ctx, { engagementId });
    expect(
      await sendProposalAsBoqCore(org.ctx, { proposalId: empty.data!, locale: 'en' }),
    ).toEqual({ ok: false, error: 'line_required' });

    const quote = await createProposalCore(org.ctx, {
      clientId: org.clientId,
      projectId: org.projectId,
    });
    expect(
      await sendProposalAsBoqCore(org.ctx, {
        proposalId: (quote as { data?: string }).data!,
        locale: 'en',
      }),
    ).toEqual({ ok: false, error: 'invalid' });

    expect(
      await sendProposalAsBoqCore(org.viewerCtx, { proposalId: empty.data!, locale: 'en' }),
    ).toEqual({ ok: false, error: 'forbidden' });
    const [boqs] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.boqs where org_id = '${org.orgId}'`,
    );
    expect(Number(boqs.n)).toBe(0);
  });

  it('a failed render writes nothing: no BOQ, no artifact, and the draft is untouched', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const id = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await sendProposalAsBoqCore(org.ctx, { proposalId: id, locale: 'en' })).toEqual({
      ok: false,
      error: 'generic',
    });
    const [counts] = await raw.query<{ boqs: number; artifacts: number }>(
      `select (select count(*)::int from public.boqs where org_id = '${org.orgId}') as boqs,
              (select count(*)::int from public.engagement_artifacts
                where engagement_id = '${engagementId}') as artifacts`,
    );
    expect(Number(counts.boqs)).toBe(0);
    expect(Number(counts.artifacts)).toBe(0);
    expect((await boqProposalRows(engagementId))[0].status).toBe('draft');
    expect(
      (await saveProposalDraftCore(org.ctx, { id, sections: TWO_SECTIONS })).ok,
    ).toBe(true);
  });
});
