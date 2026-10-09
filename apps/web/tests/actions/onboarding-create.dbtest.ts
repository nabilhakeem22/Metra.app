import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createOrgCore } from '@/lib/org/core';
import { closeFixture, ctxFor, raw, teardown } from './fixture';

// Round C (C5, AC 17): the onboarding is one screen and sends only the names and
// the city. The firm type falls to the core's default and the tax number stays
// in Settings, so this exact input must still provision a working studio.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

describe('the one-screen onboarding input', () => {
  it('Arabic name only: {interior}, an automation settings row, no tax number', async () => {
    const orgId = randomUUID();
    orgIds.push(orgId);

    const res = await createOrgCore(ctxFor(orgId, randomUUID(), 'owner'), {
      nameEn: null,
      nameAr: 'ستوديو النيل',
      city: null,
    });
    expect(res.ok).toBe(true);

    const [entitlement] = await raw.query<{ enabled_flows: string[] }>(
      `select enabled_flows from public.workspace_entitlements where org_id = '${orgId}'`,
    );
    expect(entitlement.enabled_flows).toEqual(['interior']);
    expect(await raw.count('automation_settings', orgId)).toBe(1);
    expect(await raw.memberships(orgId)).toHaveLength(1);
    const [org] = await raw.query<{ name_ar: string; tax_registration_number: string | null }>(
      `select name_ar, tax_registration_number from public.organizations where id = '${orgId}'`,
    );
    expect(org).toEqual({ name_ar: 'ستوديو النيل', tax_registration_number: null });
  });
});
