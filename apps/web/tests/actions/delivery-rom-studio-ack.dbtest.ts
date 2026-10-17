import { afterAll, describe, expect, it } from 'vitest';
import { recordEventCorrectionCore } from '@/lib/engagements/corrections';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { recordRomAcknowledgementCore } from '@/lib/engagements/rom-acknowledgement';
import { issueRomCore } from '@/lib/engagements/rom-issue';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, teardown } from './fixture';
import { seedRoundBDelivery, type RoundBDelivery } from './round-b-fixture';

// The budget acknowledgement the STUDIO records for the client (a call, a
// WhatsApp) is consent on file: Gate B accepts it, so the client page must not
// ask the client to acknowledge the same band again. Retracting it asks again.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function issuedBand(suffix: string): Promise<RoundBDelivery> {
  const delivery = await seedRoundBDelivery(orgIds, suffix);
  const { ctx, engagementId } = delivery;
  expect((await setEngagementRomCore(ctx, { engagementId, romLow: '1000000', romHigh: '1300000' })).ok).toBe(true);
  expect((await issueRomCore(ctx, { engagementId })).ok).toBe(true);
  return delivery;
}

describe('a budget acknowledgement the studio recorded for the client', () => {
  it('is the acknowledgement on the client page: no button, the day on file', async () => {
    const delivery = await issuedBand('rom-studio-ack');
    expect((await deliveryOrNull(delivery.token))!.clientActions).toContain('acknowledge_rom');

    const recorded = await recordRomAcknowledgementCore(delivery.ctx, {
      engagementId: delivery.engagementId,
      evidence: 'WhatsApp',
    });
    expect(recorded.ok).toBe(true);

    const page = (await deliveryOrNull(delivery.token))!;
    expect(page.clientActions).not.toContain('acknowledge_rom');
    expect(page.romAcknowledgedAt).toEqual(expect.any(String));
  });

  it('asks the client again once the studio retracts it', async () => {
    const delivery = await issuedBand('rom-studio-retract');
    const recorded = await recordRomAcknowledgementCore(delivery.ctx, {
      engagementId: delivery.engagementId,
      evidence: 'Phone call',
    });
    const retracted = await recordEventCorrectionCore(delivery.ctx, {
      engagementId: delivery.engagementId,
      eventId: (recorded as { data?: string }).data!,
      reason: 'Recorded on the wrong delivery',
    });
    expect(retracted.ok).toBe(true);

    const page = (await deliveryOrNull(delivery.token))!;
    expect(page.clientActions).toContain('acknowledge_rom');
    expect(page.romAcknowledgedAt).toBeNull();
  });

  it('answers only the band it acknowledged: a re-issued band is asked again', async () => {
    const delivery = await issuedBand('rom-studio-reissue');
    const { ctx, engagementId } = delivery;
    await recordRomAcknowledgementCore(ctx, { engagementId, evidence: 'WhatsApp' });
    await setEngagementRomCore(ctx, { engagementId, romLow: '1100000', romHigh: '1400000' });
    await issueRomCore(ctx, { engagementId });

    const page = (await deliveryOrNull(delivery.token))!;
    expect(page.clientActions).toContain('acknowledge_rom');
    expect(page.romAcknowledgedAt).toBeNull();
  });
});
