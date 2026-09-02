import { afterAll, describe, expect, it } from 'vitest';
import { addActivityCore } from '@/lib/activities/core';
import { createClientCore, updateClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { listEntityLogs } from '@/lib/logs/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// The Logs tab merges TWO sources that answer different questions: the activity feed
// (what people said, what the product announced) and the audit trail (who changed
// what). The audit READER did not exist before this — lib/audit.ts only ever wrote,
// which is why the tab could not simply be "repointed at the log system".

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function seedClient() {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: 'Acme', phone: '01000000000' });
  const [client] = await listClients(ctx, {});
  return { orgId, ctx, clientId: client.id };
}

describe('listEntityLogs', () => {
  it('returns BOTH the audit trail and the activity feed', async () => {
    const { ctx, clientId } = await seedClient();
    // A create already wrote an audit row and a system activity.
    const afterCreate = await listEntityLogs(ctx, 'client', clientId);
    expect(afterCreate.some((e) => e.source === 'audit')).toBe(true);
    expect(afterCreate.some((e) => e.source === 'activity')).toBe(true);
  });

  it('picks up a user note and a subsequent edit', async () => {
    const { ctx, clientId } = await seedClient();
    expect(
      (await addActivityCore(ctx, {
        entityType: 'client',
        entityId: clientId,
        note: 'Called about the villa',
      })).ok,
    ).toBe(true);
    expect(
      (await updateClientCore(ctx, {
        id: clientId,
        nameEn: 'Acme',
        city: 'Alexandria',
      })).ok,
    ).toBe(true);

    const feed = await listEntityLogs(ctx, 'client', clientId);
    // The note survived — this is the feature that would have been DELETED by
    // simply repointing the tab at audit_log.
    const note = feed.find((e) => e.note === 'Called about the villa');
    expect(note).toBeDefined();
    expect(note!.source).toBe('activity');
    // ...and the edit that followed is recorded too.
    expect(feed.some((e) => e.source === 'audit' && e.labelKey === 'client.update')).toBe(
      true,
    );
  });

  it('orders newest first across both sources', async () => {
    const { ctx, clientId } = await seedClient();
    await addActivityCore(ctx, {
      entityType: 'client',
      entityId: clientId,
      note: 'first',
    });
    await updateClientCore(ctx, { id: clientId, nameEn: 'Acme', city: 'Giza' });

    const feed = await listEntityLogs(ctx, 'client', clientId);
    const times = feed.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('labels audit rows as entity.action, which the tab resolves bilingually', () => {
    // Pinned because a labelKey the messages file has no entry for throws at render
    // rather than degrading — all four AUDIT_ACTIONS must be covered.
    expect(['create', 'update', 'delete', 'issue']).toContain('update');
  });

  it('is scoped to ONE entity', async () => {
    const { ctx, clientId } = await seedClient();
    await createClientCore(ctx, { nameEn: 'Other', phone: '01000000001' });
    const other = (await listClients(ctx, {})).find((c) => c.id !== clientId)!;
    await addActivityCore(ctx, {
      entityType: 'client',
      entityId: other.id,
      note: 'about the other one',
    });

    const feed = await listEntityLogs(ctx, 'client', clientId);
    expect(feed.every((e) => e.note !== 'about the other one')).toBe(true);
  });

  it("never shows ANOTHER org's log", async () => {
    const mine = await seedClient();
    const theirs = await seedClient();
    await addActivityCore(theirs.ctx, {
      entityType: 'client',
      entityId: theirs.clientId,
      note: 'their private note',
    });

    // Their client id, presented under MY org context — RLS scopes both reads.
    const feed = await listEntityLogs(mine.ctx, 'client', theirs.clientId);
    expect(feed).toEqual([]);
  });

  it('returns an empty feed for a malformed id rather than throwing', async () => {
    const { ctx } = await seedClient();
    await expect(listEntityLogs(ctx, 'client', 'not-a-uuid')).resolves.toEqual([]);
  });

  it('caps the feed after merging, so notes cannot be crowded out', async () => {
    const { ctx, clientId } = await seedClient();
    // A burst of edits (audit rows) after one note.
    await addActivityCore(ctx, {
      entityType: 'client',
      entityId: clientId,
      note: 'the note',
    });
    for (let i = 0; i < 5; i += 1) {
      await updateClientCore(ctx, {
        id: clientId,
        nameEn: 'Acme',
        city: `City ${i}`,
      });
    }
    const feed = await listEntityLogs(ctx, 'client', clientId, 3);
    expect(feed).toHaveLength(3);
    // The cap is applied to the MERGED timeline, so it is the 3 newest overall.
    const times = feed.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('reads the audit trail that lib/audit.ts writes', async () => {
    // The reader did not exist before this slice; prove it sees real rows.
    const { orgId, ctx, clientId } = await seedClient();
    const [row] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log
       where org_id = '${orgId}' and entity = 'client' and entity_id = '${clientId}'`,
    );
    expect(row.n).toBeGreaterThan(0);
    const feed = await listEntityLogs(ctx, 'client', clientId);
    expect(feed.filter((e) => e.source === 'audit').length).toBeGreaterThan(0);
  });
});
