import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createEngagementCore } from '@/lib/engagements/core';
import { getEngagementEvents } from '@/lib/engagements/queries';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { withOrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/**
 * Seed an org + client + project and create ONE engagement in `created`. ROM
 * acknowledgement is not state-gated (only non-terminal), so the entry state is
 * the simplest one — mirrors the setEngagementRom dbtest setup.
 */
async function setup(): Promise<{ ctx: OrgContext; engagementId: string }> {
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
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: client.id,
    projectId: project.id,
  });
  const engagementId = (created as { data?: string }).data!;
  return { ctx, engagementId };
}

/** The append-only event rows for an engagement, over the BYPASSRLS connection. */
async function eventRows(engagementId: string) {
  return raw.query<{
    id: string;
    kind: string;
    actor_user_id: string | null;
    range_low: string | null;
    range_high: string | null;
    note: string | null;
  }>(
    `select id, kind, actor_user_id, range_low, range_high, note
       from public.engagement_events
      where engagement_id = '${engagementId}'`,
  );
}

describe('recordRomAcknowledgement — client ROM ack (append-only)', () => {
  it('appends one rom_acknowledgement snapshotting the current ROM + actor', async () => {
    const { ctx, engagementId } = await setup();
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1800000',
      romHigh: '2400000',
    });

    const res = await recordRomAcknowledgementCore(ctx, { engagementId });
    expect(res.ok).toBe(true);
    expect(typeof res.data).toBe('string');

    const rows = await eventRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('rom_acknowledgement');
    // Snapshot: the event's range columns equal the engagement's ROM at ack time.
    expect(rows[0].range_low).toBe('1800000.0000');
    expect(rows[0].range_high).toBe('2400000.0000');
    expect(rows[0].actor_user_id).toBe(ctx.userId);

    // The row surfaces in the approvals-ledger read.
    const events = await getEngagementEvents(ctx, engagementId);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('rom_acknowledgement');
    expect(events[0].actorUserId).toBe(ctx.userId);
  });

  it('stores a trimmed note, or null when blank', async () => {
    const { ctx, engagementId } = await setup();
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1000000',
      romHigh: '1500000',
    });

    await recordRomAcknowledgementCore(ctx, {
      engagementId,
      note: '  client agreed by phone  ',
    });
    const [row] = await eventRows(engagementId);
    expect(row.note).toBe('client agreed by phone');
  });

  it('FREEZES the acknowledged range even if ROM is later edited (snapshot proof)', async () => {
    const { ctx, engagementId } = await setup();
    // Set ROM to band A, acknowledge it.
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1000000',
      romHigh: '2000000',
    });
    await recordRomAcknowledgementCore(ctx, { engagementId });

    // Later, the firm re-enters ROM to band B.
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '3000000',
      romHigh: '4000000',
    });

    // The existing acknowledgement still shows band A — frozen, not rewritten.
    const rows = await eventRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].range_low).toBe('1000000.0000');
    expect(rows[0].range_high).toBe('2000000.0000');
  });

  it('rejects acknowledgement when ROM was never set (rom_not_set), writing nothing', async () => {
    const { ctx, engagementId } = await setup();
    const res = await recordRomAcknowledgementCore(ctx, { engagementId });
    expect(res).toEqual({ ok: false, error: 'rom_not_set' });
    expect(await eventRows(engagementId)).toHaveLength(0);
  });

  it('rejects acknowledgement on a terminal engagement with engagement_not_active', async () => {
    const { ctx, engagementId } = await setup();
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1800000',
      romHigh: '2400000',
    });
    // Force a terminal state (abandon isn't wired here — a later step).
    await raw.query(
      `update public.design_engagements set state = 'abandoned' where id = '${engagementId}'`,
    );
    const res = await recordRomAcknowledgementCore(ctx, { engagementId });
    expect(res).toEqual({ ok: false, error: 'engagement_not_active' });
    expect(await eventRows(engagementId)).toHaveLength(0);
  });

  it('a direct UPDATE / DELETE under org context is denied (append-only grants)', async () => {
    const { ctx, engagementId } = await setup();
    await setEngagementRomCore(ctx, {
      engagementId,
      romLow: '1800000',
      romHigh: '2400000',
    });
    await recordRomAcknowledgementCore(ctx, { engagementId });

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `update public.engagement_events set note = 'tampered' where engagement_id = '${engagementId}'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql.raw(
            `delete from public.engagement_events where engagement_id = '${engagementId}'`,
          ),
        ),
      ),
    ).rejects.toThrow();

    // The row survives both attempts, unchanged.
    const rows = await eventRows(engagementId);
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBeNull();
  });
});

describe('recordRomAcknowledgement — cross-org isolation', () => {
  it('org B cannot record or read a rom_acknowledgement on org A’s engagement', async () => {
    const { ctx: ctxA, engagementId: aEngagement } = await setup();
    await setEngagementRomCore(ctxA, {
      engagementId: aEngagement,
      romLow: '1800000',
      romHigh: '2400000',
    });

    const { orgId: orgB, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgB);
    const ctxB = ctxFor(orgB, ownerIds[0], 'owner');

    // B tries to acknowledge A's engagement -> engagement_not_found (RLS hides it).
    const res = await recordRomAcknowledgementCore(ctxB, {
      engagementId: aEngagement,
    });
    expect(res).toEqual({ ok: false, error: 'engagement_not_found' });

    // A records a real acknowledgement on its own engagement.
    await recordRomAcknowledgementCore(ctxA, { engagementId: aEngagement });

    // B reads A's engagement id -> RLS scopes the ledger to empty.
    expect(await getEngagementEvents(ctxB, aEngagement)).toEqual([]);
    // A still reads its own acknowledgement.
    const eventsA = await getEngagementEvents(ctxA, aEngagement);
    expect(eventsA).toHaveLength(1);
    expect(eventsA[0].kind).toBe('rom_acknowledgement');
  });
});
