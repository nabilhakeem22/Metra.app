import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailDeliveryReminderCore } from '@/lib/engagements/reminder/email';
import { prepareDeliveryReminderCore } from '@/lib/engagements/reminder/prepare';
import {
  mintDeliveryLinkCore,
  revokeDeliveryLinkCore,
  rotateDeliveryLinkCore,
} from '@/lib/engagements/share';
import { revealDeliveryLinkCore } from '@/lib/engagements/share-reveal';
import { hashShareToken } from '@/lib/share/token';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { forceState, seedRoundBDelivery, snapshotOf, type RoundBDelivery } from './round-b-fixture';

// Round B, B11: re-derivable client links. The link is HMAC(secret, id + nonce),
// the nonce is stored beside the hash, and the studio can show and resend the
// SAME link. Pinned here against the real database:
//   * reveal returns the raw token mint returned; after a rotate the old raw no
//     longer opens the portal and reveal returns the new one; revoke clears the
//     nonce (AC 45);
//   * a link without a nonce (pre-B11) or without the secret is
//     `delivery_link_unrecoverable`, and a rotate is the way out (AC 40);
//   * preparing or emailing a reminder never changes token_hash (AC 38);
//   * only owner/admin, server-enforced; another org reads as not found.

const SECRET = 'round-b-dbtest-secret-0123456789abcdef0123456789';
let previousSecret: string | undefined;

const orgIds: string[] = [];
beforeAll(() => {
  previousSecret = process.env.SHARE_LINK_SECRET;
  process.env.SHARE_LINK_SECRET = SECRET;
});
afterAll(async () => {
  if (previousSecret === undefined) delete process.env.SHARE_LINK_SECRET;
  else process.env.SHARE_LINK_SECRET = previousSecret;
  await teardown(orgIds);
  await closeFixture();
});

const ORIGIN = 'https://metra.example';

async function linkColumns(engagementId: string) {
  const [row] = await raw.query<{ token_hash: string | null; token_nonce: string | null }>(
    `select token_hash, token_nonce from public.design_engagements where id = '${engagementId}'`,
  );
  return row;
}

async function seed(suffix: string, members: Parameters<typeof seedRoundBDelivery>[2] = []) {
  return seedRoundBDelivery(orgIds, suffix, members);
}

describe('reveal', () => {
  it('returns the raw token mint returned, from the stored nonce', async () => {
    const d = await seed('reveal-mint');
    const stored = await linkColumns(d.engagementId);
    expect(stored.token_hash).toBe(d.hash);
    expect(stored.token_nonce).not.toBeNull();

    expect(await revealDeliveryLinkCore(d.ctx, d.engagementId)).toEqual({ ok: true, data: d.token });
    // Revealing writes nothing to the link.
    expect(await linkColumns(d.engagementId)).toEqual(stored);
  });

  it('after a rotate the old link is dead and reveal returns the new one', async () => {
    const d = await seed('reveal-rotate');
    const rotated = await rotateDeliveryLinkCore(d.ctx, d.engagementId);
    expect(rotated.ok).toBe(true);
    const fresh = rotated.data!;
    expect(fresh).not.toBe(d.token);

    expect(await snapshotOf(d.hash)).toBeNull();
    expect(await snapshotOf(hashShareToken(fresh))).not.toBeNull();
    expect(await revealDeliveryLinkCore(d.ctx, d.engagementId)).toEqual({ ok: true, data: fresh });
  });

  it('revoke clears the nonce with the hash, and there is nothing to reveal', async () => {
    const d = await seed('reveal-revoke');
    expect((await revokeDeliveryLinkCore(d.ctx, d.engagementId)).ok).toBe(true);
    expect(await linkColumns(d.engagementId)).toEqual({ token_hash: null, token_nonce: null });
    expect(await revealDeliveryLinkCore(d.ctx, d.engagementId)).toEqual({
      ok: false,
      error: 'delivery_link_unrecoverable',
    });
  });

  it('a pre-B11 link (no nonce) is unrecoverable until ONE rotate replaces it', async () => {
    const d = await seed('reveal-legacy');
    await raw.query(
      `update public.design_engagements set token_nonce = null where id = '${d.engagementId}'`,
    );
    expect(await revealDeliveryLinkCore(d.ctx, d.engagementId)).toEqual({
      ok: false,
      error: 'delivery_link_unrecoverable',
    });
    expect(await prepareDeliveryReminderCore(d.ctx, d.engagementId, ORIGIN)).toEqual({
      ok: false,
      error: 'delivery_link_unrecoverable',
    });
    // The legacy link still opens the portal: nothing rotated it.
    expect(await snapshotOf(d.hash)).not.toBeNull();

    const replaced = await rotateDeliveryLinkCore(d.ctx, d.engagementId);
    expect(replaced.ok).toBe(true);
    expect(await revealDeliveryLinkCore(d.ctx, d.engagementId)).toEqual({
      ok: true,
      data: replaced.data,
    });
  });

  it('without the secret nothing is re-derivable, and the link keeps working', async () => {
    const d = await seed('reveal-no-secret');
    delete process.env.SHARE_LINK_SECRET;
    try {
      expect(await revealDeliveryLinkCore(d.ctx, d.engagementId)).toEqual({
        ok: false,
        error: 'delivery_link_unrecoverable',
      });
      // A link minted now is a plain random token with no nonce.
      const rotated = await rotateDeliveryLinkCore(d.ctx, d.engagementId);
      expect(rotated.ok).toBe(true);
      expect((await linkColumns(d.engagementId)).token_nonce).toBeNull();
      expect(await snapshotOf(hashShareToken(rotated.data!))).not.toBeNull();
    } finally {
      process.env.SHARE_LINK_SECRET = SECRET;
    }
  });

  it('a project manager is refused; another org reads it as not found', async () => {
    const d = await seed('reveal-roles', [{ role: 'project_manager' }]);
    const manager = ctxFor(d.orgId, d.memberIds[0], 'project_manager');
    expect(await revealDeliveryLinkCore(manager, d.engagementId)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await prepareDeliveryReminderCore(manager, d.engagementId, ORIGIN)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(
      await emailDeliveryReminderCore(manager, { engagementId: d.engagementId, locale: 'en' }, ORIGIN),
    ).toEqual({ ok: false, error: 'forbidden' });

    const { orgId: otherOrg, ownerIds } = await seedOrg({ owners: 1 });
    orgIds.push(otherOrg);
    const stranger = ctxFor(otherOrg, ownerIds[0], 'owner');
    expect(await revealDeliveryLinkCore(stranger, d.engagementId)).toEqual({
      ok: false,
      error: 'engagement_not_found',
    });
    expect(await revealDeliveryLinkCore(d.ctx, 'not-a-uuid')).toEqual({
      ok: false,
      error: 'engagement_not_found',
    });
  });
});

describe('reminders never rotate the link (AC 38)', () => {
  async function unchanged(d: RoundBDelivery, act: () => Promise<unknown>): Promise<void> {
    const before = await linkColumns(d.engagementId);
    await act();
    expect(await linkColumns(d.engagementId)).toEqual(before);
    expect(await snapshotOf(d.hash)).not.toBeNull();
  }

  it('prepare: both messages carry the EXISTING link; WhatsApp gets the client phone', async () => {
    const d = await seed('reminder-prepare');
    await unchanged(d, async () => {
      const prepared = await prepareDeliveryReminderCore(d.ctx, d.engagementId, ORIGIN);
      expect(prepared.ok).toBe(true);
      expect(prepared.data!.messages['ar-EG']).toContain(`${ORIGIN}/ar-EG/d/${d.token}`);
      expect(prepared.data!.messages.en).toContain(`${ORIGIN}/en/d/${d.token}`);
      expect(prepared.data!.whatsappDigits).toBe('201000000000');
      expect(prepared.data!.defaultLocale).toBe('ar-EG');
      expect(prepared.data!.clientEmail).toBeNull();
    });
  });

  it('email: no address is client_email_missing; a failed send is reminder_email_failed', async () => {
    const d = await seed('reminder-email');
    await unchanged(d, async () => {
      expect(
        await emailDeliveryReminderCore(d.ctx, { engagementId: d.engagementId, locale: 'ar-EG' }, ORIGIN),
      ).toEqual({ ok: false, error: 'client_email_missing' });
    });

    await raw.query(
      `update public.clients set email = 'client@example.com'
        where id = (select client_id from public.design_engagements where id = '${d.engagementId}')`,
    );
    // No Resend key in this environment: the send is refused, the link untouched.
    await unchanged(d, async () => {
      expect(
        await emailDeliveryReminderCore(d.ctx, { engagementId: d.engagementId, locale: 'en' }, ORIGIN),
      ).toEqual({ ok: false, error: 'reminder_email_failed' });
    });
    expect(
      await emailDeliveryReminderCore(d.ctx, { engagementId: d.engagementId, locale: 'fr' }, ORIGIN),
    ).toEqual({ ok: false, error: 'invalid' });
  });

  it('a closed delivery has nobody to remind', async () => {
    const d = await seed('reminder-closed');
    await forceState(d.engagementId, 'abandoned');
    expect(await prepareDeliveryReminderCore(d.ctx, d.engagementId, ORIGIN)).toEqual({
      ok: false,
      error: 'engagement_not_active',
    });
  });

  it('a second mint on a shared delivery is still refused (the link is never replaced silently)', async () => {
    const d = await seed('reminder-mint-twice');
    expect(await mintDeliveryLinkCore(d.ctx, d.engagementId)).toEqual({ ok: false, error: 'invalid' });
    expect((await linkColumns(d.engagementId)).token_hash).toBe(d.hash);
  });
});
