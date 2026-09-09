import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { getEngagementRom } from '@/lib/engagements/queries';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/**
 * Seed an org + client + project and create ONE engagement in `created`. ROM
 * entry needs no particular state — only a non-terminal engagement — so the
 * entry state is the simplest one.
 */
async function setup(): Promise<{ ctx: OrgContext; engagementId: string }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: client.id,
    projectId: project.id,
  });
  const engagementId = (created as { data?: string }).data!;
  return { ctx, engagementId };
}

/** The `rom_range_set` rows for an engagement, oldest first (BYPASSRLS). */
async function issuedRows(engagementId: string) {
  return raw.query<{ kind: string; range_low: string; range_high: string; actor_user_id: string | null }>(
    `select kind, range_low, range_high, actor_user_id
       from public.engagement_events
      where engagement_id = '${engagementId}' and kind = 'rom_range_set'
      order by decided_at`,
  );
}

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

describe('setEngagementRom — coarse build-cost band entry', () => {
  it('stores a valid low–high range canonically and reads it back', async () => {
    const { ctx, engagementId } = await setup();
    const res = await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1800000',
      romHigh: '2400000',
    });
    expect(res).toEqual({ ok: true, data: undefined });

    const rom = await getEngagementRom(ctx, engagementId);
    expect(rom).toEqual({ romLow: '1800000.0000', romHigh: '2400000.0000' });
    // Pure data entry: state never moves.
    expect(await stateOf(engagementId)).toBe('created');
  });

  it('appends the band to the append-only ledger, so a revision cannot erase it', async () => {
    // The columns hold the CURRENT band and a revision overwrites them, which is
    // fine for a guard and useless to a studio asked "what did we quote in
    // August". Every band issued gets a row of its own (0042).
    const { ctx, engagementId } = await setup();
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1500000',
      romHigh: '2500000',
    });
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1800000',
      romHigh: '2200000',
    });

    // The columns carry only the latest...
    expect(await getEngagementRom(ctx, engagementId)).toEqual({
      romLow: '1800000.0000',
      romHigh: '2200000.0000',
    });
    // ...and the ledger carries both, in the order they were offered.
    const issued = await issuedRows(engagementId);
    expect(issued.map((r) => [r.range_low, r.range_high])).toEqual([
      ['1500000.0000', '2500000.0000'],
      ['1800000.0000', '2200000.0000'],
    ]);
    expect(issued[0].actor_user_id).toBe(ctx.userId);
  });

  it('writes NO ledger row when the range is rejected', async () => {
    // The event insert shares the action's transaction, so a rejected band must
    // leave no trace at all — a history of ranges that were never offered would
    // be worse than no history.
    const { ctx, engagementId } = await setup();
    const res = await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '2400000',
      romHigh: '1800000',
    });
    expect(res.ok).toBe(false);
    expect(await issuedRows(engagementId)).toHaveLength(0);
  });

  it('accepts an equal low and high (a single-point band)', async () => {
    const { ctx, engagementId } = await setup();
    const res = await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '2000000',
      romHigh: '2000000',
    });
    expect(res.ok).toBe(true);
    const rom = await getEngagementRom(ctx, engagementId);
    expect(rom).toEqual({ romLow: '2000000.0000', romHigh: '2000000.0000' });
  });

  it('rejects romHigh < romLow with rom_range_invalid, writing nothing', async () => {
    const { ctx, engagementId } = await setup();
    const res = await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '2400000',
      romHigh: '1800000',
    });
    expect(res).toEqual({ ok: false, error: 'rom_range_invalid' });
    expect(await getEngagementRom(ctx, engagementId)).toEqual({
      romLow: null,
      romHigh: null,
    });
  });

  it('rejects a zero or malformed (comma-decimal) value with rom_range_invalid', async () => {
    const { ctx, engagementId } = await setup();
    const bad: { romLow: string; romHigh: string }[] = [
      { romLow: '0', romHigh: '2400000' },
      { romLow: '1800000', romHigh: '0' },
      { romLow: '1,5', romHigh: '2400000' },
      { romLow: '1800000', romHigh: 'abc' },
      { romLow: '-1800000', romHigh: '2400000' },
    ];
    for (const range of bad) {
      const res = await setEngagementRomCore(ctx, { engagementId, ...range });
      expect(res).toEqual({ ok: false, error: 'rom_range_invalid' });
    }
    expect(await getEngagementRom(ctx, engagementId)).toEqual({
      romLow: null,
      romHigh: null,
    });
  });

  it('rejects ROM entry on a terminal engagement with engagement_not_active', async () => {
    const { ctx, engagementId } = await setup();
    // Force a terminal state (abandon isn't wired here — a later step).
    await raw.query(
      `update public.design_engagements set state = 'abandoned' where id = '${engagementId}'`,
    );
    const res = await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1800000',
      romHigh: '2400000',
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_active' });
    expect(await getEngagementRom(ctx, engagementId)).toEqual({
      romLow: null,
      romHigh: null,
    });
  });
});

describe('setEngagementRom — cross-org isolation', () => {
  it('org B cannot set or read ROM on org A’s engagement', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setup();

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    // B tries to set ROM on A's engagement -> engagement_not_found (RLS hides it).
    const res = await setEngagementRomCore(ctxB, {
      engagementId: aEngagement,
      romLow: '1800000',
      romHigh: '2400000',
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });

    // A sets a real ROM on its own engagement.
    await setEngagementRomCore(ctxA, {
      engagementId: aEngagement,
      romLow: '1800000',
      romHigh: '2400000',
    });

    // B reads A's engagement id -> RLS scopes it to an empty band.
    expect(await getEngagementRom(ctxB, aEngagement)).toEqual({
      romLow: null,
      romHigh: null,
    });
    // A still reads its own band.
    expect(await getEngagementRom(ctxA, aEngagement)).toEqual({
      romLow: '1800000.0000',
      romHigh: '2400000.0000',
    });
  });
});
