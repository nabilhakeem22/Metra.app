import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createOrgCore } from '@/lib/org/core';
import { closeFixture, ctxFor, raw, teardown } from './fixture';

const orgIds: string[] = [];

afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('createOrgCore', () => {
  it('creates org + owner membership + audit atomically', async () => {
    const orgId = randomUUID();
    const userId = randomUUID();
    orgIds.push(orgId);

    const res = await createOrgCore(ctxFor(orgId, userId, 'owner'), {
      nameEn: 'Acme Fit-out',
      city: 'Cairo',
    });
    expect(res.ok).toBe(true);

    // FK to organizations means a membership row implies the org exists.
    const members = await raw.memberships(orgId);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ user_id: userId, role: 'owner' });
    expect(await raw.count('audit_log', orgId)).toBe(1);
  });

  it('rejects when no name is provided', async () => {
    const res = await createOrgCore(ctxFor(randomUUID(), randomUUID(), 'owner'), {});
    expect(res).toEqual({ ok: false, error: 'name_required' });
  });
});
