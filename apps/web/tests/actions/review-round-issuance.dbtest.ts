import { afterAll, describe, expect, it, vi } from 'vitest';
import { approveDesignWithBudgetAndNotify, respondToDesignAndNotify } from '@/lib/engagements/client-acts/design-acts';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { reviewSeenOf } from '@/lib/engagements/review-seen';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, rendersReadyAtText, seedArtifact, seedRoundBDelivery, stampRenders, type RoundBDelivery } from './round-b-fixture';
import { clientEventCount, consentCounts, issueBand, pageSeenWithBand } from './round-d-db-fixture';

// Round D, the issuance a review act names, through the real app path:
// - the microsecond round trip app -> drizzle -> Postgres (lead addendum 3);
// - A1: a render shown before the client decided is a new round (lead
//   addendum 2), and no read comes before the write;
// - A3: a page from before Round D (the old fingerprint) writes nothing.

const order = vi.hoisted(() => ({ log: [] as string[] }));
vi.mock('@/lib/engagements/client-acts/saved-delivery', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/engagements/client-acts/saved-delivery')>();
  return { savedDelivery: (token: string) => (order.log.push('read'), real.savedDelivery(token)) };
});
vi.mock('@/lib/engagements/public/respond', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/engagements/public/respond')>();
  return {
    ...real,
    recordDeliveryActionByToken: (...args: Parameters<typeof real.recordDeliveryActionByToken>) => {
      order.log.push('write');
      return real.recordDeliveryActionByToken(...args);
    },
  };
});
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function atFinalApproval(suffix: string): Promise<RoundBDelivery> {
  const d = await seedRoundBDelivery(orgIds, suffix);
  await forceState(d.engagementId, 'final_approval');
  await stampRenders(d.engagementId, `'2026-10-10 07:00:00.123456+00'::timestamptz`);
  await issueBand(d.engagementId, 900000, 1200000, `'2026-10-10 08:00:00.654321+00'::timestamptz`);
  return d;
}

const page = async (d: RoundBDelivery) => (await deliveryOrNull(d.token))!;

describe('the microsecond round trip (app -> drizzle -> Postgres)', () => {
  it('the stamps the page read are accepted as read; one microsecond off is refused', async () => {
    const d = await atFinalApproval('stamp-us');
    const { rom, rendersIssuedAt } = await page(d);
    expect(rom!.issuedAt).toMatch(/\.654321/);
    expect(rendersIssuedAt).toMatch(/\.123456/);
    const offByOne = rom!.issuedAt.replace('.654321', '.654322');
    expect(await recordDeliveryActionByToken(d.token, { action: 'acknowledge_rom', expectedIssueAt: offByOne })).toEqual({ ok: false, error: 'wrong_state' });
    expect(await recordDeliveryActionByToken(d.token, { action: 'acknowledge_rom', expectedIssueAt: rom!.issuedAt })).toEqual({ ok: true });
    expect(await recordDeliveryActionByToken(d.token, { action: 'approve_design', expectedIssueAt: rendersIssuedAt })).toEqual({ ok: true });
    const [stored] = await raw.query<{ rom: boolean; renders: boolean }>(
      `select bool_and(e.acknowledged_issue_at = '2026-10-10 08:00:00.654321+00'::timestamptz)
                filter (where e.kind = 'rom_acknowledgement') as rom,
              bool_and(e.acknowledged_issue_at = '2026-10-10 07:00:00.123456+00'::timestamptz)
                filter (where e.kind = 'design_approval') as renders
         from public.engagement_events e where e.engagement_id = '${d.engagementId}'`,
    );
    expect(stored).toEqual({ rom: true, renders: true });
  });
});

describe('A1: a render shown before the client decided starts a new round (render-round-restamp.dbtest.ts has the rest)', () => {
  it('a render ADDED (shown) after the stamp re-stamps the round: a decision on the earlier page is refused, nothing written, no read first', async () => {
    const d = await atFinalApproval('a1-added');
    const seen = reviewSeenOf(await page(d));
    const before = await rendersReadyAtText(d.engagementId);
    await seedArtifact(d, 'approved_render');
    expect(await rendersReadyAtText(d.engagementId)).not.toBe(before);
    order.log = [];
    expect(await respondToDesignAndNotify(d.token, { action: 'approve_design' }, seen)).toEqual({ kind: 'changed' });
    expect(order.log[0]).toBe('write');
    expect(await clientEventCount(d.engagementId)).toBe(0);
  });
});

describe('an instant shaped like a stamp that Postgres cannot read (D3 F7, L1)', () => {
  it.each(['2026-13-45T25:61:61Z', '2026-02-30T10:00:00Z', '2026-02-30', '2026-10-12T10:00:00+99:00', '0000-01-01T00:00:00Z'])(
    '%s is wrong_state through the app and the server actions; nothing is written, nothing throws',
    async (crafted) => {
      const { acknowledgeDeliveryBudget, respondToDeliveryDesign } = await import('@/app/[locale]/d/[token]/review-actions');
      const d = await atFinalApproval(`crafted-${crafted.slice(0, 10)}`);
      for (const action of ['approve_design', 'acknowledge_rom']) {
        expect(await recordDeliveryActionByToken(d.token, { action, expectedIssueAt: crafted })).toEqual({ ok: false, error: 'wrong_state' });
      }
      const seen = { romIssuedAt: null, rendersIssuedAt: crafted };
      expect(await respondToDeliveryDesign(d.token, 'approve_design', 'note', seen)).toEqual({ kind: 'changed' });
      expect(await acknowledgeDeliveryBudget(d.token, crafted)).toEqual({ kind: 'changed' });
      expect(await clientEventCount(d.engagementId)).toBe(0);
    },
  );
});

describe('F3: a stale approve+budget on a delivery that has ended', () => {
  it('answers the budget acknowledgement on file for that band, never "could not be saved"', async () => {
    const d = await atFinalApproval('f3-ended');
    const seen = await pageSeenWithBand(d.token);
    expect(await approveDesignWithBudgetAndNotify(d.token, {}, seen)).toMatchObject({ kind: 'approved', budget: 'acknowledged' });
    await forceState(d.engagementId, 'execution');
    expect(await approveDesignWithBudgetAndNotify(d.token, {}, seen)).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    expect((await consentCounts(d.engagementId)).romAcknowledgements).toBe(1);
  });
});

describe('A3: a page from before Round D writes nothing', () => {
  it('the old { band, round } shape reads "changed": no row, no notification', async () => {
    const { approveDesignWithBudget, respondToDeliveryDesign } = await import('@/app/[locale]/d/[token]/review-actions');
    const d = await atFinalApproval('a3-old-shape');
    const old = { band: '900000.0000..1200000.0000', round: '2026-10-10T07:00:00.123Z|' };
    expect(await approveDesignWithBudget(d.token, '', old)).toEqual({ kind: 'changed', budget: 'changed' });
    expect(await respondToDeliveryDesign(d.token, 'approve_design', '', old)).toEqual({ kind: 'changed' });
    expect(await consentCounts(d.engagementId)).toEqual({ designApprovals: 0, romAcknowledgements: 0, notified: {}, designBudgetParams: [] });
  });
});
