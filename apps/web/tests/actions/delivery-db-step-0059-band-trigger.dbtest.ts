import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withOrgContext } from '@/lib/db/context';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { issueRomCore } from '@/lib/engagements/rom-issue';
import { closeFixture, raw, teardown } from './fixture';
import { seedRoundBDelivery, type RoundBDelivery } from './round-b-fixture';
import { issuancesOf, issueBand, respondSeen } from './round-d-db-fixture';

// Round D, PR-D2 fix round (security L2): trg_design_engagements_rom_issue
// makes "a changed band is not issued" the database's rule. An UPDATE that
// changes rom_low or rom_high and keeps rom_issued_at clears the stamp, so the
// client's acknowledgement of the old issuance cannot land on the new numbers.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const SIGNATURE = 'public.clear_rom_issue_on_band_change()';

async function bandOf(d: RoundBDelivery) {
  const [row] = await raw.query<{ low: string | null; high: string | null; issued: string | null }>(
    `select rom_low::text as low, rom_high::text as high, to_char(rom_issued_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as issued
       from public.design_engagements where id = '${d.engagementId}'`,
  );
  return row;
}

describe('a band change without a new stamp clears the stamp (L2)', () => {
  it('a writer that forgets the clear, as the app role, leaves the band unissued and the old consent refused', async () => {
    const d = await seedRoundBDelivery(orgIds, 'trigger-forgot');
    await issueBand(d.engagementId, 900000, 1200000, `now() - interval '1 hour'`);
    const seen = (await issuancesOf(d.hash)).rom;
    await withOrgContext(d.ctx, (tx) =>
      tx.execute(sql`update public.design_engagements set rom_low = 2500000, rom_high = 3000000
                      where id = ${d.engagementId}`),
    );
    expect(await bandOf(d)).toEqual({ low: '2500000.0000', high: '3000000.0000', issued: null });
    expect(await respondSeen(d.hash, 'acknowledge_rom', seen)).toBe('wrong_state');
  });

  it('only one end of the band changing clears it too', async () => {
    const d = await seedRoundBDelivery(orgIds, 'trigger-one-end');
    await issueBand(d.engagementId, 100000, 200000, `now() - interval '1 hour'`);
    await raw.query(`update public.design_engagements set rom_high = 250000 where id = '${d.engagementId}'`);
    expect((await bandOf(d)).issued).toBeNull();
  });

  it('an issue that sets the band and the stamp in one statement is left alone', async () => {
    const d = await seedRoundBDelivery(orgIds, 'trigger-issue');
    await issueBand(d.engagementId, 100000, 200000, `timestamptz '2026-10-01 10:00:00+00'`);
    await issueBand(d.engagementId, 150000, 250000, `timestamptz '2026-10-02 10:00:00+00'`);
    expect(await bandOf(d)).toEqual({ low: '150000.0000', high: '250000.0000', issued: '2026-10-02 10:00:00' });
  });

  it('the same numbers again, or a stamp alone, keep the stamp', async () => {
    const d = await seedRoundBDelivery(orgIds, 'trigger-same');
    await issueBand(d.engagementId, 100000, 200000, `timestamptz '2026-10-01 10:00:00+00'`);
    await raw.query(`update public.design_engagements set rom_low = 100000, rom_high = 200000 where id = '${d.engagementId}'`);
    expect((await bandOf(d)).issued).toBe('2026-10-01 10:00:00');
    await raw.query(`update public.design_engagements set rom_issued_at = timestamptz '2026-10-03 10:00:00+00' where id = '${d.engagementId}'`);
    expect((await bandOf(d)).issued).toBe('2026-10-03 10:00:00');
  });

  it("the app's own flows: set, issue, set again", async () => {
    const d = await seedRoundBDelivery(orgIds, 'trigger-app');
    expect((await setEngagementRomCore(d.ctx, { engagementId: d.engagementId, romLow: '100000', romHigh: '200000' })).ok).toBe(true);
    expect((await issueRomCore(d.ctx, { engagementId: d.engagementId })).ok).toBe(true);
    expect((await bandOf(d)).issued).not.toBeNull();
    expect((await setEngagementRomCore(d.ctx, { engagementId: d.engagementId, romLow: '120000', romHigh: '220000' })).ok).toBe(true);
    expect(await bandOf(d)).toEqual({ low: '120000.0000', high: '220000.0000', issued: null });
  });
});

describe('the trigger and its function are in place and locked down', () => {
  it('fires before an update of the band; metra_app may run the function, PUBLIC and the API roles not', async () => {
    const [trigger] = await raw.query<{ def: string; enabled: string }>(
      `select pg_get_triggerdef(oid) as def, tgenabled as enabled from pg_trigger
        where tgrelid = 'public.design_engagements'::regclass and tgname = 'trg_design_engagements_rom_issue'`,
    );
    expect(trigger.enabled).toBe('O');
    expect(trigger.def).toContain('BEFORE UPDATE OF rom_low, rom_high ON public.design_engagements FOR EACH ROW');
    const [grants] = await raw.query<{ metra_app: boolean; public_grants: number }>(
      `select has_function_privilege('metra_app', '${SIGNATURE}', 'execute') as metra_app,
              (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0) as public_grants
         from pg_proc p where p.oid = '${SIGNATURE}'::regprocedure`,
    );
    expect(grants).toEqual({ metra_app: true, public_grants: 0 });
    const roles = await raw.query<{ rolname: string }>(
      `select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`,
    );
    for (const { rolname } of roles) {
      const [api] = await raw.query<{ allowed: boolean }>(
        `select has_function_privilege('${rolname}', '${SIGNATURE}', 'execute') as allowed`,
      );
      expect(api.allowed, rolname).toBe(false);
    }
  });
});
