import { sqlstateOf } from '@metra/db/sqlstate';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, teardown } from './fixture';
import { seedRoundBDelivery } from './round-b-fixture';
import { notificationsOf, plantEvent, sweepAs, sweepRoles } from './round-c-db-fixture';

// Round C, PR-C7: WHO may run the lost-notification sweep, and over what
// (AC 40, the gate half). Only an owner or admin member of the org named in
// the GUCs, inside that org's transaction; a sane window; a role map. The
// anchor rule behind it is callable by nobody but the definer functions.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const LOST = `now() - interval '30 minutes'`;

describe('app_notify_lost_client_acts: the gate (AC 40)', () => {
  it('answers null with no org GUCs (the base connection)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'gate-no-guc');
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    const [row] = await raw.query<{ data: unknown }>(
      `select public.app_notify_lost_client_acts(now() - interval '48 hours',
         now() - interval '10 minutes', '${JSON.stringify(sweepRoles())}'::jsonb) as data`,
    );
    expect(row.data).toBeNull();
    expect(await notificationsOf(d.engagementId)).toEqual([]);
  });

  it('answers null for a project manager, a site engineer and an accountant; an admin may run it', async () => {
    const d = await seedRoundBDelivery(orgIds, 'gate-roles', [
      { role: 'project_manager' }, { role: 'site_engineer' }, { role: 'accountant' }, { role: 'admin' },
    ]);
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    const [pm, engineer, accountant, admin] = d.memberIds;
    expect(await sweepAs(ctxFor(d.orgId, pm, 'project_manager'))).toBeNull();
    expect(await sweepAs(ctxFor(d.orgId, engineer, 'site_engineer'))).toBeNull();
    expect(await sweepAs(ctxFor(d.orgId, accountant, 'accountant'))).toBeNull();
    expect(await notificationsOf(d.engagementId)).toEqual([]);
    expect(await sweepAs(ctxFor(d.orgId, admin, 'admin'))).toHaveLength(1);
  });

  it("an owner of one org cannot sweep another org by naming it in the GUCs", async () => {
    const mine = await seedRoundBDelivery(orgIds, 'gate-tenant-mine');
    const theirs = await seedRoundBDelivery(orgIds, 'gate-tenant-theirs');
    await plantEvent(theirs, { kind: 'handoff_acknowledgement', at: LOST });
    expect(await sweepAs(ctxFor(theirs.orgId, mine.ownerId, 'owner'))).toBeNull();
    expect(await notificationsOf(theirs.engagementId)).toEqual([]);
  });

  it('refuses a bad window or a role map that is not an object', async () => {
    const d = await seedRoundBDelivery(orgIds, 'gate-window');
    await plantEvent(d, { kind: 'handoff_acknowledgement', at: LOST });
    const ago = (interval: string) => `now() - interval '${interval}'`;
    expect(await sweepAs(d.ctx, ago('10 minutes'), ago('48 hours'))).toBeNull();
    expect(await sweepAs(d.ctx, ago('1 hour'), ago('1 hour'))).toBeNull();
    expect(await sweepAs(d.ctx, ago('1 hour'), `now() + interval '1 minute'`)).toBeNull();
    expect(await sweepAs(d.ctx, ago('8 days'), ago('10 minutes'))).toBeNull();
    expect(await sweepAs(d.ctx, undefined, undefined, ['owner'])).toBeNull();
    expect(await sweepAs(d.ctx, undefined, undefined, null)).toBeNull();
    expect(await notificationsOf(d.engagementId)).toEqual([]);
  });

  it('metra_app may not run the anchor rule itself (42501)', async () => {
    const d = await seedRoundBDelivery(orgIds, 'gate-anchor');
    const outcome = await withOrgContext(d.ctx, (tx) =>
      tx.execute(sql`select public.app_client_act_anchor(
        ${d.engagementId}::uuid, ${d.orgId}::uuid, 'client_handover_acknowledged', null)`),
    ).then(() => 'ran', (error: unknown) => sqlstateOf(error));
    expect(outcome).toBe('42501');
  });
});
