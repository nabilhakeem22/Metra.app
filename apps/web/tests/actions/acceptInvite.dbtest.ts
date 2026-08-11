import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { acceptInviteCore } from '@/lib/team/core';
import {
  closeFixture,
  ctxFor,
  seedOrg,
  seedPendingInvite,
  teardown,
} from './fixture';

const orgIds: string[] = [];

afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('acceptInviteCore', () => {
  it('joins on first claim', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const email = `uc-${randomUUID()}@example.com`;
    const userId = randomUUID();
    const invId = await seedPendingInvite(orgId, email, ownerIds[0], 'viewer');

    const res = await acceptInviteCore(
      ctxFor(orgId, userId, 'viewer', email),
      invId,
    );
    expect(res).toEqual({ ok: true });
  });

  it('reports already on a second open of the same invite', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const email = `uc-${randomUUID()}@example.com`;
    const userId = randomUUID();
    const invId = await seedPendingInvite(orgId, email, ownerIds[0], 'viewer');
    const ctx = ctxFor(orgId, userId, 'viewer', email);

    await acceptInviteCore(ctx, invId);
    const second = await acceptInviteCore(ctx, invId);
    expect(second).toEqual({ ok: true, already: true });
  });

  it('declines when the caller email does not match the invite', async () => {
    const { orgId, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(orgId);
    const invId = await seedPendingInvite(
      orgId,
      `invited-${randomUUID()}@example.com`,
      ownerIds[0],
      'viewer',
    );

    const res = await acceptInviteCore(
      ctxFor(orgId, randomUUID(), 'viewer', 'wrong@example.com'),
      invId,
    );
    expect(res).toEqual({ ok: false, error: 'declined' });
  });
});
