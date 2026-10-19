import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { recordWhatsappOpenedCore } from '@/lib/engagements/reminder/whatsapp-opened';
import { closeFixture, raw, teardown } from './fixture';
import { DAY_MS, delivery, followupAlert, ledgerOf, rescueOrg, transition } from './rescue-ledger-fixture';

// The "Open WhatsApp" click record against a real database (lead ruling, Oct
// 20): one audit row per click, owner/admin only, this workspace's deliveries
// only, and the rescue ledger counts it as the WhatsApp reminder.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const clicks = (orgId: string) =>
  raw.query<{ entity_id: string; actor_user_id: string }>(
    `select entity_id, actor_user_id from public.audit_log
      where org_id = '${orgId}' and entity = 'design_engagement' and after ->> 'reminder' = 'whatsapp_opened'`,
  );

describe('recordWhatsappOpenedCore', () => {
  it('writes one audit row per click, by the clicking member', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    expect(await recordWhatsappOpenedCore(org.contexts.admin, id)).toEqual({ ok: true });
    expect(await clicks(org.orgId)).toEqual([{ entity_id: id, actor_user_id: org.contexts.admin.userId }]);
  });

  it('refuses a role outside the reminder dialog, a foreign or unknown delivery, and a malformed id, writing nothing', async () => {
    const org = await rescueOrg(orgIds);
    const other = await rescueOrg(orgIds);
    const foreign = await delivery(other, 1);
    expect(await recordWhatsappOpenedCore(org.contexts.project_manager, foreign)).toEqual({ ok: false, error: 'forbidden' });
    expect((await recordWhatsappOpenedCore(org.contexts.owner, foreign)).error).toBe('engagement_not_found');
    expect((await recordWhatsappOpenedCore(org.contexts.owner, randomUUID())).error).toBe('engagement_not_found');
    expect(await recordWhatsappOpenedCore(org.contexts.owner, 'not-a-uuid')).toEqual({ ok: false, error: 'malformed' });
    expect(await clicks(org.orgId)).toEqual([]);
    expect(await clicks(other.orgId)).toEqual([]);
  });

  it('a real click between the alert and the move is the R2 action', async () => {
    const org = await rescueOrg(orgIds);
    const id = await delivery(org, 1);
    const now = Date.now();
    await transition(org, id, 'optionsReady', 'layout', 'concept_review', new Date(now - 10 * DAY_MS));
    await followupAlert(org, id, new Date(now - 5 * DAY_MS));
    expect((await recordWhatsappOpenedCore(org.contexts.owner, id)).ok).toBe(true);
    await transition(org, id, 'selectConcept', 'concept_review', 'negotiation', new Date(now + 60_000));
    expect((await ledgerOf(org)).stagesMoved.count).toBe(1);
  });
});
