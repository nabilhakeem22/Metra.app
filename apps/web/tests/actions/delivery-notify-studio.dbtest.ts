import { afterAll, describe, expect, it } from 'vitest';
import { revokeDeliveryLinkCore } from '@/lib/engagements/share';
import { markNotificationReadCore } from '@/lib/notifications/core';
import { countUnread, listNotifications } from '@/lib/notifications/queries';
import { closeFixture, ctxFor, raw, teardown } from './fixture';
import {
  attestAt,
  chooseConcept,
  forceState,
  seedArtifact,
  seedRoundBDelivery,
  type RoundBDelivery,
} from './round-b-fixture';

// Round B, wave 2 (PR-B9): app_delivery_notify_studio_by_token (AC 34). The
// portal calls it after a client act answered `ok`; it writes the studio's
// in-app notifications. Pinned here:
//   * tenancy: recipients come from the DELIVERY's org only, by the role list
//     the caller passes, never the `client` role;
//   * owner decision Q2: the design-act list includes site engineers, the
//     payment list is owner, admin and accountant;
//   * dedupe: ONE unread row per (recipient, delivery, body key, milestone); a
//     repeat bumps params.count and reports no new recipient; a read row is
//     never bumped; claims on two milestones are two rows (0057, F5);
//   * the answer carries the delivery's number, Cairo year and titles (0057, R4);
//   * a concept choice's rows carry the letter SAVED with it, never the caller's;
//   * malformed input and dead links answer null and write nothing.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const DESIGN_ACT_ROLES = '["owner","admin","project_manager","site_engineer"]';
const PAYMENT_ACT_ROLES = '["owner","admin","accountant"]';

interface NotifyResult {
  engagement_id: string;
  locale: string;
  notified_count: number;
  new_recipients: string[];
  number: number;
  year: number;
  title_ar: string | null;
  title_en: string | null;
}

/** The delivery's own number and Cairo creation year, read independently. */
async function identityOf(engagementId: string): Promise<{ number: number; year: number }> {
  const [identity] = await raw.query<{ number: number; year: number }>(
    `select number, extract(year from created_at at time zone 'Africa/Cairo')::int as year
       from public.design_engagements where id = '${engagementId}'`,
  );
  return identity;
}

function sqlJson(value: string | null): string {
  return value === null ? 'null' : `'${value}'::jsonb`;
}

/** Call the notifier exactly as the PR-B10 wrapper will. */
async function notify(
  hash: string,
  bodyKey: string,
  roles: string | null,
  params: string | null = '{}',
): Promise<NotifyResult | null> {
  const [row] = await raw.query<{ data: NotifyResult | null }>(
    `select public.app_delivery_notify_studio_by_token(
       '${hash}', '${bodyKey}', ${sqlJson(params)}, ${sqlJson(roles)}
     ) as data`,
  );
  return row.data;
}

interface NotificationRow {
  id: string;
  recipient_user_id: string;
  kind: string;
  entity_type: string | null;
  entity_id: string | null;
  body_key: string;
  params: Record<string, unknown>;
  read_at: string | null;
}

async function notificationsOf(orgId: string): Promise<NotificationRow[]> {
  return raw.query<NotificationRow>(
    `select id, recipient_user_id, kind, entity_type, entity_id, body_key, params,
            read_at::text as read_at
       from public.notifications where org_id = '${orgId}'
      order by recipient_user_id, created_at`,
  );
}

function recipientsOf(rows: NotificationRow[]): string[] {
  return [...new Set(rows.map((row) => row.recipient_user_id))].sort();
}

/** owner, then: admin, project_manager, site_engineer, accountant, viewer, client. */
async function seedStudio(suffix: string): Promise<RoundBDelivery & { roleIds: Record<string, string> }> {
  const delivery = await seedRoundBDelivery(orgIds, suffix, [
    { role: 'admin' },
    { role: 'project_manager' },
    { role: 'site_engineer' },
    { role: 'accountant' },
    { role: 'viewer' },
    { role: 'client' },
  ]);
  const [admin, projectManager, siteEngineer, accountant, viewer, client] = delivery.memberIds;
  return {
    ...delivery,
    roleIds: {
      owner: delivery.ownerId,
      admin,
      project_manager: projectManager,
      site_engineer: siteEngineer,
      accountant,
      viewer,
      client,
    },
  };
}

describe('notify studio: recipients by role, in the delivery org only', () => {
  it('notifies each owner/admin of THAT org once, with the delivery identity', async () => {
    const studio = await seedStudio('notify-roles');
    const otherOrg = await seedStudio('notify-other-org');

    const result = await notify(
      studio.hash,
      'client_payment_claimed',
      '["owner","admin"]',
      '{"milestoneKind":"deposit"}',
    );
    const expected = [studio.roleIds.owner, studio.roleIds.admin].sort();
    const identity = await identityOf(studio.engagementId);
    expect(result).toEqual({
      engagement_id: studio.engagementId,
      locale: 'ar-EG',
      notified_count: 2,
      new_recipients: expected,
      number: identity.number,
      year: identity.year,
      title_ar: 'فيلا',
      title_en: 'Villa notify-roles',
    });

    const rows = await notificationsOf(studio.orgId);
    expect(recipientsOf(rows)).toEqual(expected);
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: 'client_responded',
        entity_type: 'engagement',
        entity_id: studio.engagementId,
        body_key: 'client_payment_claimed',
        read_at: null,
      });
      expect(row.params).toEqual({
        milestoneKind: 'deposit',
        number: identity.number,
        year: identity.year,
        titleAr: 'فيلا',
        titleEn: 'Villa notify-roles',
        count: 1,
      });
    }
    // The other org has the same roles and hears nothing.
    expect(await notificationsOf(otherOrg.orgId)).toEqual([]);
  });

  it('Q2: a design act reaches owner, admin, project manager and site engineer', async () => {
    const studio = await seedStudio('notify-q2-design');
    const result = await notify(studio.hash, 'client_design_approved', DESIGN_ACT_ROLES);
    const expected = ['owner', 'admin', 'project_manager', 'site_engineer']
      .map((role) => studio.roleIds[role])
      .sort();
    expect(result!.notified_count).toBe(4);
    expect(result!.new_recipients).toEqual(expected);
    expect(recipientsOf(await notificationsOf(studio.orgId))).toEqual(expected);
  });

  it('Q2: a payment claim reaches owner, admin and accountant only', async () => {
    const studio = await seedStudio('notify-q2-payment');
    const result = await notify(studio.hash, 'client_payment_claimed', PAYMENT_ACT_ROLES);
    const expected = ['owner', 'admin', 'accountant'].map((role) => studio.roleIds[role]).sort();
    expect(result!.notified_count).toBe(3);
    expect(recipientsOf(await notificationsOf(studio.orgId))).toEqual(expected);
  });

  it('never notifies the client role, even when the list names it', async () => {
    const studio = await seedStudio('notify-client-role');
    const result = await notify(studio.hash, 'client_commented', '["client","viewer"]');
    expect(result!.notified_count).toBe(1);
    expect(recipientsOf(await notificationsOf(studio.orgId))).toEqual([studio.roleIds.viewer]);
  });

  it('an empty role list is valid and notifies nobody', async () => {
    const studio = await seedStudio('notify-empty-roles');
    expect(await notify(studio.hash, 'client_commented', '[]')).toMatchObject({
      engagement_id: studio.engagementId,
      locale: 'ar-EG',
      notified_count: 0,
      new_recipients: [],
    });
    expect(await notificationsOf(studio.orgId)).toEqual([]);
  });

  it("keeps the delivery's own number and titles over a same-named caller param", async () => {
    const studio = await seedStudio('notify-spoof');
    await notify(studio.hash, 'client_commented', '["owner"]', '{"number":999,"titleEn":"Spoof"}');
    const [row] = await notificationsOf(studio.orgId);
    expect(row.params.number).not.toBe(999);
    expect(row.params.titleEn).toBe('Villa notify-spoof');
  });
});

describe('notify studio: one unread row per (recipient, delivery, body key)', () => {
  it('bumps the unread row on a repeat, and starts a new one once it is read', async () => {
    const studio = await seedStudio('notify-dedupe');
    const roles = '["owner","admin"]';
    const owner = studio.roleIds.owner;
    const admin = studio.roleIds.admin;
    await notify(studio.hash, 'client_commented', roles, '{"count":"7"}');
    // Back-date, so "moved to now" is visible regardless of clock resolution.
    await raw.query(
      `update public.notifications set created_at = '2000-01-01T00:00:00Z'
        where org_id = '${studio.orgId}'`,
    );

    const repeat = await notify(studio.hash, 'client_commented', roles);
    expect(repeat!.notified_count).toBe(2);
    expect(repeat!.new_recipients).toEqual([]);
    const afterRepeat = await notificationsOf(studio.orgId);
    expect(afterRepeat).toHaveLength(2);
    // The function owns `count`: the caller's "7" was overwritten on insert.
    for (const row of afterRepeat) expect(row.params.count).toBe(2);
    const [moved] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.notifications
        where org_id = '${studio.orgId}' and created_at > timestamptz '2001-01-01'`,
    );
    expect(Number(moved.n)).toBe(2);

    // The owner reads theirs through the app's own path (RLS, recipient-scoped).
    const ownerCtx = ctxFor(studio.orgId, owner, 'owner');
    const [ownerRow] = await listNotifications(ownerCtx, { limit: 8 });
    expect(ownerRow.bodyKey).toBe('client_commented');
    expect((await markNotificationReadCore(ownerCtx, { id: ownerRow.id })).ok).toBe(true);
    expect(await countUnread(ownerCtx)).toBe(0);

    const third = await notify(studio.hash, 'client_commented', roles);
    expect(third!.notified_count).toBe(2);
    expect(third!.new_recipients).toEqual([owner]);
    const rows = await notificationsOf(studio.orgId);
    const ownerRows = rows.filter((row) => row.recipient_user_id === owner);
    expect(ownerRows).toHaveLength(2);
    expect(ownerRows.find((row) => row.read_at !== null)!.params.count).toBe(2);
    expect(ownerRows.find((row) => row.read_at === null)!.params.count).toBe(1);
    const adminRows = rows.filter((row) => row.recipient_user_id === admin);
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0].params.count).toBe(3);
    expect(await countUnread(ownerCtx)).toBe(1);
  });

  it('keeps a separate row per body key', async () => {
    const studio = await seedStudio('notify-per-key');
    await notify(studio.hash, 'client_commented', '["owner"]');
    const other = await notify(studio.hash, 'client_design_approved', '["owner"]');
    expect(other!.new_recipients).toEqual([studio.roleIds.owner]);
    const rows = await notificationsOf(studio.orgId);
    expect(rows.map((row) => row.body_key).sort()).toEqual([
      'client_commented',
      'client_design_approved',
    ]);
  });

  it('keeps a separate row per delivery for the same recipient', async () => {
    const first = await seedStudio('notify-per-delivery');
    await notify(first.hash, 'client_commented', '["owner"]');
    // A second delivery of the SAME org, on its own live link.
    await raw.query(
      `update public.design_engagements set state = 'abandoned' where id = '${first.engagementId}'`,
    );
    const [project] = await raw.query<{ id: string; client_id: string }>(
      `select project_id as id, client_id from public.design_engagements
        where id = '${first.engagementId}'`,
    );
    const [second] = await raw.query<{ id: string }>(
      `insert into public.design_engagements
         (org_id, number, title_en, client_id, project_id, token_hash)
       values ('${first.orgId}', 9999, 'Second', '${project.client_id}', '${project.id}',
               'notify-per-delivery-second-hash')
       returning id`,
    );
    const result = await notify('notify-per-delivery-second-hash', 'client_commented', '["owner"]');
    expect(result!.engagement_id).toBe(second.id);
    expect(result!.new_recipients).toEqual([first.roleIds.owner]);
    const rows = await notificationsOf(first.orgId);
    expect(rows.map((row) => row.entity_id).sort()).toEqual([first.engagementId, second.id].sort());
  });

  it('two concurrent identical acts land one row per recipient with count 2', async () => {
    const studio = await seedStudio('notify-race');
    const roles = '["owner","admin"]';
    const [a, b] = await Promise.all([
      notify(studio.hash, 'client_concept_approved', roles),
      notify(studio.hash, 'client_concept_approved', roles),
    ]);
    const newcomers = [...a!.new_recipients, ...b!.new_recipients].sort();
    expect(newcomers).toEqual([studio.roleIds.owner, studio.roleIds.admin].sort());
    const rows = await notificationsOf(studio.orgId);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.params.count).toBe(2);
  });
});

describe('notify studio: malformed input and dead links answer null, write nothing', () => {
  it('refuses a bad body key, a non-array role list and a non-object params', async () => {
    const studio = await seedStudio('notify-malformed');
    expect(await notify(studio.hash, 'bad key', '["owner"]')).toBeNull();
    expect(await notify(studio.hash, 'client_', '["owner"]')).toBeNull();
    expect(await notify(studio.hash, 'CLIENT_COMMENTED', '["owner"]')).toBeNull();
    expect(await notify(studio.hash, 'proposal_accepted', '["owner"]')).toBeNull();
    expect(await notify(studio.hash, `client_${'x'.repeat(61)}`, '["owner"]')).toBeNull();
    expect(await notify(studio.hash, 'client_commented', '{"owner":true}')).toBeNull();
    expect(await notify(studio.hash, 'client_commented', '"owner"')).toBeNull();
    expect(await notify(studio.hash, 'client_commented', null)).toBeNull();
    expect(await notify(studio.hash, 'client_commented', '["owner"]', '[1]')).toBeNull();
    expect(await notificationsOf(studio.orgId)).toEqual([]);
    // A null params is allowed: only the delivery identity and the count are stored.
    expect((await notify(studio.hash, 'client_commented', '["owner"]', null))!.notified_count).toBe(
      1,
    );
  });

  it('accepts only the nine client-act keys (S3)', async () => {
    const studio = await seedStudio('notify-allowlist');
    // Well-formed client_* keys that are NOT one of the nine: refused.
    for (const key of ['client_ok', 'client_hello', 'client_concept_approvedx']) {
      expect(await notify(studio.hash, key, '["owner"]')).toBeNull();
    }
    expect(await notificationsOf(studio.orgId)).toEqual([]);
    const allowed = [
      'client_concept_approved',
      'client_concept_chosen',
      'client_concept_changes_requested',
      'client_design_approved',
      'client_design_changes_requested',
      'client_budget_acknowledged',
      'client_handover_acknowledged',
      'client_payment_claimed',
      'client_commented',
    ];
    for (const key of allowed) {
      expect((await notify(studio.hash, key, '["owner"]'))!.notified_count).toBe(1);
    }
    const rows = await notificationsOf(studio.orgId);
    expect(rows.map((row) => row.body_key).sort()).toEqual([...allowed].sort());
  });

  it('refuses params over 2048 bytes and treats JSON null as no params (S3, F5)', async () => {
    const studio = await seedStudio('notify-params-size');
    const oversized = JSON.stringify({ note: 'x'.repeat(2100) });
    expect(await notify(studio.hash, 'client_commented', '["owner"]', oversized)).toBeNull();
    expect(await notificationsOf(studio.orgId)).toEqual([]);

    // JSON.stringify(null) is what a TS caller sends for "no params".
    const result = await notify(studio.hash, 'client_commented', '["owner"]', 'null');
    expect(result!.notified_count).toBe(1);
    const [row] = await notificationsOf(studio.orgId);
    expect(Object.keys(row.params).sort()).toEqual(['count', 'number', 'titleAr', 'titleEn', 'year']);
  });

  it("dates the DE number in the studio's local year (Africa/Cairo, L2)", async () => {
    const studio = await seedStudio('notify-year');
    // 23:30 UTC on 31 December is 01:30 on 1 January in Cairo.
    await raw.query(
      `update public.design_engagements set created_at = '2026-12-31T23:30:00Z'
        where id = '${studio.engagementId}'`,
    );
    await notify(studio.hash, 'client_commented', '["owner"]');
    const [row] = await notificationsOf(studio.orgId);
    expect(row.params.year).toBe(2027);
  });

  it('answers null for an unknown, expired or revoked link', async () => {
    const studio = await seedStudio('notify-dead-links');
    expect(await notify('never-minted-hash', 'client_commented', '["owner"]')).toBeNull();
    await raw.query(
      `update public.design_engagements set share_expires_at = now() - interval '1 minute'
        where id = '${studio.engagementId}'`,
    );
    expect(await notify(studio.hash, 'client_commented', '["owner"]')).toBeNull();
    expect((await revokeDeliveryLinkCore(studio.ctx, studio.engagementId)).ok).toBe(true);
    expect(await notify(studio.hash, 'client_commented', '["owner"]')).toBeNull();
    expect(await notificationsOf(studio.orgId)).toEqual([]);
  });

  it('a notification is visible only to its recipient (recipient-scoped RLS)', async () => {
    const studio = await seedStudio('notify-rls');
    await notify(studio.hash, 'client_commented', '["owner"]');
    const ownerCtx = ctxFor(studio.orgId, studio.roleIds.owner, 'owner');
    const adminCtx = ctxFor(studio.orgId, studio.roleIds.admin, 'admin');
    expect(await listNotifications(ownerCtx)).toHaveLength(1);
    expect(await listNotifications(adminCtx)).toEqual([]);
    expect(await countUnread(adminCtx)).toBe(0);
  });
});

describe('notify studio: one unread row per payment MILESTONE (0057, F5)', () => {
  it('a claim on another milestone is a new row and a new email; the same one is a bump', async () => {
    const studio = await seedStudio('notify-f5');
    const roles = '["owner","admin"]';
    const both = [studio.roleIds.owner, studio.roleIds.admin].sort();

    const deposit = await notify(studio.hash, 'client_payment_claimed', roles, '{"milestoneKind":"deposit"}');
    expect(deposit!.new_recipients).toEqual(both);
    const gateA = await notify(studio.hash, 'client_payment_claimed', roles, '{"milestoneKind":"gate_a"}');
    expect(gateA!.new_recipients).toEqual(both);

    const rows = await notificationsOf(studio.orgId);
    for (const recipient of both) {
      const own = rows.filter((row) => row.recipient_user_id === recipient);
      expect(own.map((row) => row.params.milestoneKind).sort()).toEqual(['deposit', 'gate_a']);
      expect(own.every((row) => row.read_at === null && row.params.count === 1)).toBe(true);
    }

    // The deposit again while its row is unread: that row is bumped, gate_a is not.
    const again = await notify(studio.hash, 'client_payment_claimed', roles, '{"milestoneKind":"deposit"}');
    expect(again!.new_recipients).toEqual([]);
    expect(again!.notified_count).toBe(2);
    const after = await notificationsOf(studio.orgId);
    expect(after).toHaveLength(4);
    for (const row of after) {
      expect(row.params.count).toBe(row.params.milestoneKind === 'deposit' ? 2 : 1);
    }
  });

  it('every other key still collapses per (recipient, delivery, body key)', async () => {
    const studio = await seedStudio('notify-f5-other');
    await notify(studio.hash, 'client_commented', '["owner"]');
    const repeat = await notify(studio.hash, 'client_commented', '["owner"]', '{"milestoneKind":"deposit"}');
    // A milestone on a non-payment key is a different dedupe key: never sent by
    // the app (acts.ts adds it only to payment claims), pinned so it stays a
    // separate row rather than silently merging into another milestone's.
    expect(repeat!.new_recipients).toEqual([studio.roleIds.owner]);
    const plain = await notify(studio.hash, 'client_commented', '["owner"]');
    expect(plain!.new_recipients).toEqual([]);
  });
});

describe('notify studio: the answer names the delivery (0057, R4)', () => {
  it('returns the number, the Cairo creation year and both titles', async () => {
    const studio = await seedStudio('notify-r4');
    await raw.query(
      `update public.design_engagements set created_at = '2026-12-31T23:30:00Z'
        where id = '${studio.engagementId}'`,
    );
    const identity = await identityOf(studio.engagementId);
    expect(identity.year).toBe(2027);
    expect(await notify(studio.hash, 'client_commented', '["owner"]')).toMatchObject({
      number: identity.number,
      year: 2027,
      title_ar: 'فيلا',
      title_en: 'Villa notify-r4',
    });
  });
});

describe('notify studio: a chosen option carries the SAVED letter (0057)', () => {
  it('reads optionPosition from the choice row and ignores the caller', async () => {
    const studio = await seedStudio('notify-letter');
    await forceState(studio.engagementId, 'concept_review');
    const first = await seedArtifact(studio, 'concept_option');
    const second = await seedArtifact(studio, 'concept_option');
    await attestAt(first, '2026-01-01T00:00:00Z');
    await attestAt(second, '2026-01-02T00:00:00Z');
    expect(await chooseConcept(studio.hash, second, 2)).toBe('ok');

    await notify(studio.hash, 'client_concept_chosen', '["owner","admin"]', '{"optionPosition":4}');
    const rows = await notificationsOf(studio.orgId);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.params.optionPosition).toBe(2);
  });

  it('without a choice there is no letter, whatever the caller sends', async () => {
    const studio = await seedStudio('notify-no-letter');
    await notify(studio.hash, 'client_concept_chosen', '["owner"]', '{"optionPosition":3}');
    await notify(studio.hash, 'client_commented', '["owner"]', '{"optionPosition":3}');
    for (const row of await notificationsOf(studio.orgId)) {
      expect(row.params).not.toHaveProperty('optionPosition');
    }
  });
});
