import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GET as downloadDocument } from '@/app/[locale]/d/[token]/documents/[documentId]/route';
import { getEngagementBoqReleasable } from '@/lib/engagements/queries';
import { getDeliveryDocumentByToken } from '@/lib/engagements/public-documents';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import {
  boqProposalWith,
  commitFromSnapshot,
  rawEngagement,
  seedBoqOrg,
  TWO_SECTIONS,
} from './boq-proposal-fixture';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, raw, teardown } from './fixture';

// THE BOQ'S OWN RELEASE RULE (`app_boq_releasable`): a BOQ is withheld unless the
// engagement HAS a fee schedule and it is settled. Every issue publishes, so a BOQ
// issued while the engagement is still at `created`, with no milestones, is in the
// delivery link at once; under the free-gate rule of
// `app_engagement_payments_settled` ("no milestones = settled") it would have been
// downloadable at once too. The settled test itself is unchanged.
vi.mock('@/lib/pdf/render', () => ({
  renderPdf: () => Promise.reject(new Error('no renderer in the dbtest runner')),
}));
// The download route signs a Storage URL only for a document it releases. A
// withheld one must never get that far.
const signing = vi.hoisted(() => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('@/lib/storage/signed-urls', () => signing);

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function settledTest(engagementId: string): Promise<boolean> {
  const [row] = await raw.query<{ ok: boolean }>(
    `select public.app_engagement_payments_settled('${engagementId}') as ok`,
  );
  return row.ok;
}

async function download(token: string, documentId: string) {
  const url = `http://localhost/en/d/${token}/documents/${documentId}`;
  return downloadDocument(new NextRequest(url), {
    params: Promise.resolve({ locale: 'en', token, documentId }),
  });
}

describe('a BOQ on an engagement with NO fee schedule (S1)', () => {
  it('is published but withheld: listed withheld, refused by the download route', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const minted = await mintDeliveryLinkCore(org.ctx, engagementId);
    expect(minted.ok).toBe(true);
    const token = minted.data!;
    const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    expect((await commitFromSnapshot(org.ctx, org.orgId, proposalId)).result.ok).toBe(true);

    const [artifact] = await raw.query<{ id: string; client_visible: boolean }>(
      `select id, client_visible from public.engagement_artifacts
        where engagement_id = '${engagementId}' and kind = 'boq'`,
    );
    expect(artifact.client_visible).toBe(true);

    // The free gate still says "settled" for this engagement: it is the BOQ's own
    // rule that withholds it, not a change to the shared test.
    expect(await settledTest(engagementId)).toBe(true);
    expect(await getEngagementBoqReleasable(org.ctx, engagementId)).toBe(false);

    const listed = (await deliveryOrNull(token))?.documents.find((d) => d.id === artifact.id);
    expect(listed?.access).toBe('withheld');
    expect((await getDeliveryDocumentByToken(token, artifact.id))?.access).toBe('withheld');

    const response = await download(token, artifact.id);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('document=unavailable');
    expect(signing.createSignedObjectUrl).not.toHaveBeenCalled();
  });

  it('leaves every other kind on the free gate: a survey still downloads', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const minted = await mintDeliveryLinkCore(org.ctx, engagementId);
    const [file] = await raw.query<{ id: string }>(
      `insert into public.files (org_id, entity, entity_id, object_key, original_name)
       values ('${org.orgId}', 'engagement', '${engagementId}',
               '${org.orgId}/engagement/' || gen_random_uuid(), 'Survey.pdf')
       returning id`,
    );
    const [survey] = await raw.query<{ id: string }>(
      `insert into public.engagement_artifacts
         (org_id, engagement_id, kind, file_id, label, attested_by, client_visible)
       values ('${org.orgId}', '${engagementId}', 'survey', '${file.id}', 'Survey',
               '${org.ctx.userId}', true)
       returning id`,
    );
    const listed = (await deliveryOrNull(minted.data!))?.documents.find(
      (d) => d.id === survey.id,
    );
    expect(listed?.access).toBe('download');
  });
});
