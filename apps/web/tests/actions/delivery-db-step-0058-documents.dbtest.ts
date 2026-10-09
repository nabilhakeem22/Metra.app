import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { recordDeliveryActionByToken } from '@/lib/engagements/public';
import { revokeDeliveryLinkCore } from '@/lib/engagements/share';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedArtifact, seedFile, seedRoundBDelivery, snapshotOf, type RoundBDelivery } from './round-b-fixture';
import { plantEvent, retract } from './round-c-db-fixture';

// Round C, PR-C7: the media rule (AC 36), the studio logo by token (AC 37) and
// the handover close target by token (AC 38).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function scalar<T>(expression: string): Promise<T> {
  const [row] = await raw.query<{ value: T }>(`select ${expression} as value`);
  return row.value;
}

describe('app_document_media (AC 36)', () => {
  it('classes by extension, case-blind, and a null name is other', async () => {
    const cases: Array<[string | null, string]> = [
      ['a.png', 'image'], ['B.JPEG', 'image'], ['c.webp', 'image'], ['x.jpg', 'image'],
      ['d.PDF', 'pdf'], ['e.dwg', 'other'], ['noextension', 'other'], ['f.png.zip', 'other'], [null, 'other'],
    ];
    for (const [name, media] of cases) {
      const argument = name === null ? 'null' : `'${name}'`;
      expect(await scalar(`public.app_document_media(${argument})`), String(name)).toBe(media);
    }
  });

  it('the download resolver and the snapshot give the same media for the same document', async () => {
    const d = await seedRoundBDelivery(orgIds, 'media');
    const names = ['plan.PDF', 'render.webp', 'model.dwg'];
    const ids: string[] = [];
    for (const name of names) {
      const id = await seedArtifact(d, 'concept_option');
      await raw.query(
        `update public.files set original_name = '${name}'
          where id = (select file_id from public.engagement_artifacts where id = '${id}')`,
      );
      ids.push(id);
    }
    const listed = (await snapshotOf(d.hash))!.documents as Array<{ id: string; media: string }>;
    for (const [index, id] of ids.entries()) {
      const resolved = await scalar<{ media: string }>(`public.app_delivery_document_by_token('${d.hash}', '${id}')`);
      expect(resolved.media, names[index]).toBe(['pdf', 'image', 'other'][index]);
      expect(listed.find((doc) => doc.id === id)?.media).toBe(resolved.media);
    }
  });
});

async function setLogo(d: RoundBDelivery, name: string, orgId = d.orgId): Promise<string> {
  const fileId = await seedFile(orgId, d.engagementId);
  await raw.query(`update public.files set original_name = '${name}' where id = '${fileId}'`);
  await raw.query(`update public.organizations set logo_file_id = '${fileId}' where id = '${d.orgId}'`);
  return fileId;
}

const logoOf = (hash: string) => scalar<{ bucket: string; object_key: string } | null>(
  `public.app_delivery_logo_by_token('${hash}')`,
);

describe('app_delivery_logo_by_token (AC 37)', () => {
  it('bucket and object key for a PNG logo; null for no logo, a PDF logo, an expired or revoked link', async () => {
    const d = await seedRoundBDelivery(orgIds, 'logo');
    expect(await logoOf(d.hash)).toBeNull();
    const fileId = await setLogo(d, 'Studio Logo.PNG');
    expect(await logoOf(d.hash)).toEqual({ bucket: 'metra-files', object_key: `${d.orgId}/engagement/${fileId}` });
    expect(await logoOf('never-minted-hash')).toBeNull();

    await raw.query(
      `update public.design_engagements set share_expires_at = now() - interval '1 minute' where id = '${d.engagementId}'`,
    );
    expect(await logoOf(d.hash)).toBeNull();
    await raw.query(`update public.design_engagements set share_expires_at = null where id = '${d.engagementId}'`);
    expect(await logoOf(d.hash)).not.toBeNull();
    expect((await revokeDeliveryLinkCore(d.ctx, d.engagementId)).ok).toBe(true);
    expect(await logoOf(d.hash)).toBeNull();

    const pdf = await seedRoundBDelivery(orgIds, 'logo-pdf');
    await setLogo(pdf, 'logo.pdf');
    expect(await logoOf(pdf.hash)).toBeNull();
  });

  it("never serves another org's file, even if logo_file_id points at it", async () => {
    const mine = await seedRoundBDelivery(orgIds, 'logo-tenant');
    const theirs = await seedRoundBDelivery(orgIds, 'logo-tenant-other');
    await setLogo(mine, 'their-logo.png', theirs.orgId);
    expect(await logoOf(mine.hash)).toBeNull();
  });
});

const targetOf = (hash: string) => scalar<{ org_id: string; engagement_id: string } | null>(
  `public.app_delivery_close_target_by_token('${hash}')`,
);

describe('app_delivery_close_target_by_token (AC 38)', () => {
  it('null before the client confirms, the target after, null once retracted', async () => {
    const d = await seedRoundBDelivery(orgIds, 'close-target');
    await forceState(d.engagementId, 'design_only_handoff');
    expect(await targetOf(d.hash)).toBeNull();
    expect(await recordDeliveryActionByToken(d.token, { action: 'acknowledge_handoff' })).toEqual({ ok: true });
    expect(await targetOf(d.hash)).toEqual({ org_id: d.orgId, engagement_id: d.engagementId });
    const [ack] = await raw.query<{ id: string }>(
      `select id from public.engagement_events where engagement_id = '${d.engagementId}'
          and kind = 'handoff_acknowledgement'`,
    );
    await retract(d, ack.id);
    expect(await targetOf(d.hash)).toBeNull();
  });

  it('null once closed, for a staff-only acknowledgement, and for an unknown token', async () => {
    const closed = await seedRoundBDelivery(orgIds, 'close-closed');
    await forceState(closed.engagementId, 'design_only_handoff');
    expect(await recordDeliveryActionByToken(closed.token, { action: 'acknowledge_handoff' })).toEqual({ ok: true });
    await forceState(closed.engagementId, 'closed_design_only');
    expect(await targetOf(closed.hash)).toBeNull();

    const staff = await seedRoundBDelivery(orgIds, 'close-staff');
    await forceState(staff.engagementId, 'design_only_handoff');
    await plantEvent(staff, { kind: 'handoff_acknowledgement', channel: 'staff' });
    expect(await targetOf(staff.hash)).toBeNull();
    expect(await targetOf(randomUUID())).toBeNull();
  });
});
