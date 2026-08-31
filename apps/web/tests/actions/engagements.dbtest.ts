import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { withOrgContext } from '@/lib/db/context';
import { createEngagementCore } from '@/lib/engagements/core';
import { formatDocNumber } from '@/lib/format/doc-number';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** Seed an org with one client + one project; return the ctx + their ids. */
async function setup(): Promise<{
  orgId: string;
  ctx: OrgContext;
  clientId: string;
  projectId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  return { orgId, ctx, clientId: client.id, projectId: project.id };
}

describe('createEngagementCore (Design-Engagement Machine, Step 1)', () => {
  it('creates a row in state `created` with number rendered DE-YYYY-NNNN', async () => {
    const { ctx, clientId, projectId } = await setup();
    const res = await createEngagementCore(ctx, {
      titleEn: 'Villa fit-out',
      clientId,
      projectId,
    });
    expect(res.ok).toBe(true);
    const id = (res as { data?: string }).data!;

    const [row] = await raw.query<{
      number: number;
      state: string;
      off_plan: boolean;
      free_revision_n: number;
      revision_count: number;
      free_design_revision_n: number;
      design_revision_count: number;
      created_at: string;
    }>(
      `select number, state, off_plan, free_revision_n, revision_count,
              free_design_revision_n, design_revision_count, created_at
       from public.design_engagements where id = '${id}'`,
    );
    expect(row.state).toBe('created');
    expect(row.off_plan).toBe(false);
    expect(Number(row.free_revision_n)).toBe(3);
    expect(Number(row.revision_count)).toBe(0);
    // The 3D allowance is configured exactly like the concept one — a column
    // DEFAULT, set by no app code and no UI. Both start full and empty.
    expect(Number(row.free_design_revision_n)).toBe(3);
    expect(Number(row.design_revision_count)).toBe(0);

    const year = new Date(row.created_at).getFullYear();
    const rendered = formatDocNumber('DE', Number(row.number), year);
    expect(rendered).toMatch(/^DE-\d{4}-\d{4}$/);
    expect(rendered).toBe(`DE-${year}-${String(row.number).padStart(4, '0')}`);
  });

  it('two concurrent creates get distinct sequential numbers (no unique collision)', async () => {
    // One delivery per project, so contend on the org-level number sequence
    // with two *different* projects rather than two deliveries on one project.
    const { ctx, clientId, projectId } = await setup();
    const second = await createProjectCore(ctx, {
      code: `PRJ2-${ctx.orgId.slice(0, 8)}`,
      nameEn: 'Tower B',
      clientId,
      status: 'active',
    });
    expect(second.ok).toBe(true);
    const projectId2 = (second as { data?: string }).data!;
    const [a, b] = await Promise.all([
      createEngagementCore(ctx, { titleEn: 'A', clientId, projectId }),
      createEngagementCore(ctx, { titleEn: 'B', clientId, projectId: projectId2 }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const nums = await raw.query<{ number: number }>(
      `select number from public.design_engagements
       where org_id = '${ctx.orgId}' order by number`,
    );
    const values = nums.map((r) => Number(r.number));
    expect(values).toEqual([1, 2]);
  });

  it('rejects a foreign-org clientId (not visible in-org)', async () => {
    const a = await setup();
    const b = await setup();
    expect(
      await createEngagementCore(a.ctx, {
        titleEn: 'X',
        clientId: b.clientId,
        projectId: a.projectId,
      }),
    ).toEqual({ ok: false, error: 'engagement_client_required' });
  });

  it('rejects a foreign-org projectId (not visible in-org)', async () => {
    const a = await setup();
    const b = await setup();
    expect(
      await createEngagementCore(a.ctx, {
        titleEn: 'X',
        clientId: a.clientId,
        projectId: b.projectId,
      }),
    ).toEqual({ ok: false, error: 'engagement_project_required' });
  });

  it('rejects a header with neither title present', async () => {
    const { ctx, clientId, projectId } = await setup();
    expect(
      await createEngagementCore(ctx, { titleAr: '  ', clientId, projectId }),
    ).toEqual({ ok: false, error: 'engagement_title_required' });
  });

  it('cross-org: org A cannot see org B engagement', async () => {
    const a = await setup();
    const b = await setup();
    const created = await createEngagementCore(b.ctx, {
      titleEn: 'B secret',
      clientId: b.clientId,
      projectId: b.projectId,
    });
    const bId = (created as { data?: string }).data!;

    // BYPASSRLS confirms the row really exists in org B.
    const [exists] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.design_engagements where id = '${bId}'`,
    );
    expect(Number(exists.n)).toBe(1);

    // Under org A context the row is invisible (RLS + membership second factor).
    const seen = await withOrgContext(a.ctx, (tx) =>
      tx.execute(
        sql.raw(
          `select count(*)::int as n from public.design_engagements where id = '${bId}'`,
        ),
      ),
    );
    expect(Number((seen as unknown as Array<{ n: number }>)[0].n)).toBe(0);
  });
});
