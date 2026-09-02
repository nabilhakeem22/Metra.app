import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { setArtifactClientVisibilityCore } from '@/lib/engagements/client-visibility';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { getDeliveryByToken } from '@/lib/engagements/public';
import { getDeliveryDocumentByToken } from '@/lib/engagements/public-documents';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Client Deliverables, Step 3 — deliverables gated on payment.
//   * The BOQ is WITHHELD until every scheduled milestone is settled: it carries
//     the firm's own rates and is the thing the studio is paid for.
//   * The approved 3D render is PREVIEW until then — the client may look at a
//     downscaled rendition, but the full-resolution file stays in the bucket.
//   * Everything else is unaffected.
// The rule lives in ONE place (`app_document_access`), and BOTH the portal list and
// the download resolver read it, so the button and the bytes can never disagree.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface Seeded {
  ctx: OrgContext;
  orgId: string;
  engagementId: string;
  token: string;
}

async function seedFile(
  orgId: string,
  engagementId: string,
  originalName: string,
): Promise<string> {
  const fileId = randomUUID();
  await raw.query(
    `insert into public.files (id, org_id, entity, entity_id, bucket, object_key, original_name)
     values ('${fileId}', '${orgId}', 'engagement', '${engagementId}',
             'metra-files', '${orgId}/engagement/${fileId}', '${originalName}')`,
  );
  return fileId;
}

/**
 * Seed a delivery whose fee schedule is the THREE-payment default (deposit /
 * gate_b / balance, 40-30-30 percent), with a design fee of 100,000.
 */
async function seedDelivery(suffix: string): Promise<Seeded> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: `Acme ${suffix}` });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: client.id,
    projectId: project.id,
  });
  const engagementId = (created as { data?: string }).data!;
  const submitted = await executeTransition(ctx, {
    engagementId,
    trigger: 'submitDesignFee',
    payload: {
      designFee: '100000',
      milestones: [
        { kind: 'deposit', basis: 'percent', value: '40' },
        { kind: 'gate_b', basis: 'percent', value: '30' },
        { kind: 'balance', basis: 'percent', value: '30' },
      ],
    },
  });
  expect(submitted.ok).toBe(true);
  const minted = await mintDeliveryLinkCore(ctx, engagementId);
  expect(minted.ok).toBe(true);
  return { ctx, orgId, engagementId, token: minted.data! };
}

/** Record a released artifact of `kind` with a file named `originalName`. */
async function seedReleased(
  delivery: Seeded,
  kind: Parameters<typeof recordArtifactCore>[1]['kind'],
  originalName: string,
): Promise<string> {
  const res = await recordArtifactCore(delivery.ctx, {
    engagementId: delivery.engagementId,
    kind,
    fileId: await seedFile(delivery.orgId, delivery.engagementId, originalName),
  });
  expect(res.ok).toBe(true);
  const artifactId = res.data!;
  expect(
    (await setArtifactClientVisibilityCore(delivery.ctx, { artifactId, visible: true }))
      .ok,
  ).toBe(true);
  return artifactId;
}

/** Pay every milestone in full, so the engagement becomes fully settled. */
async function settleEverything(delivery: Seeded): Promise<void> {
  for (const [kind, amount] of [
    ['deposit', '40000'],
    ['gate_b', '30000'],
    ['balance', '30000'],
  ] as const) {
    expect(
      (await recordPaymentCore(delivery.ctx, {
        engagementId: delivery.engagementId,
        kind,
        amount,
      })).ok,
    ).toBe(true);
  }
}

/** The access verdict the PORTAL LIST shows for one artifact. */
async function listedAccess(
  delivery: Seeded,
  artifactId: string,
): Promise<string | undefined> {
  const snapshot = await getDeliveryByToken(delivery.token);
  return snapshot?.documents.find((d) => d.id === artifactId)?.access;
}

describe('the BOQ is withheld until the money is in', () => {
  it('is withheld on BOTH the list and the resolver while anything is owed', async () => {
    const delivery = await seedDelivery('boq-unpaid');
    const boqId = await seedReleased(delivery, 'boq', 'Villa BOQ with our rates.xlsx');

    expect(await listedAccess(delivery, boqId)).toBe('withheld');
    // The resolver behind the download route agrees — the button is not the gate.
    const target = await getDeliveryDocumentByToken(delivery.token, boqId);
    expect(target?.access).toBe('withheld');
  });

  it('becomes downloadable once EVERY milestone is settled', async () => {
    const delivery = await seedDelivery('boq-paid');
    const boqId = await seedReleased(delivery, 'boq', 'Villa BOQ.xlsx');
    expect(await listedAccess(delivery, boqId)).toBe('withheld');

    await settleEverything(delivery);

    expect(await listedAccess(delivery, boqId)).toBe('download');
    expect((await getDeliveryDocumentByToken(delivery.token, boqId))?.access).toBe(
      'download',
    );
  });

  it('stays withheld while even a PARTIAL amount is outstanding', async () => {
    // A 39,999.99 payment against a 40,000 deposit must not open the gate — the
    // math is exact scale-4, not "close enough".
    const delivery = await seedDelivery('boq-partial');
    const boqId = await seedReleased(delivery, 'boq', 'Villa BOQ.xlsx');
    await recordPaymentCore(delivery.ctx, {
      engagementId: delivery.engagementId,
      kind: 'deposit',
      amount: '39999.99',
    });
    expect(await listedAccess(delivery, boqId)).toBe('withheld');
  });
});

describe('the 3D render is viewable but not downloadable until paid', () => {
  it('is PREVIEW while money is owed, and download once settled', async () => {
    const delivery = await seedDelivery('render');
    const renderId = await seedReleased(
      delivery,
      'approved_render',
      'Villa render FINAL.png',
    );

    expect(await listedAccess(delivery, renderId)).toBe('preview');
    expect((await getDeliveryDocumentByToken(delivery.token, renderId))?.access).toBe(
      'preview',
    );

    await settleEverything(delivery);
    expect(await listedAccess(delivery, renderId)).toBe('download');
  });

  it('WITHHOLDS a render that cannot be downscaled (a PDF), rather than leaking it', async () => {
    // Storage transforms images only; a PDF comes back untouched. Serving it as a
    // "preview" would hand the unpaid client the full deliverable, so it fails
    // closed instead.
    const delivery = await seedDelivery('render-pdf');
    const pdfRenderId = await seedReleased(
      delivery,
      'approved_render',
      'Villa render FINAL.pdf',
    );
    expect(await listedAccess(delivery, pdfRenderId)).toBe('withheld');

    await settleEverything(delivery);
    // Once paid it is a normal download — the PDF was never the problem, only
    // showing it for free was.
    expect(await listedAccess(delivery, pdfRenderId)).toBe('download');
  });

  it('reads the extension case-insensitively', async () => {
    const delivery = await seedDelivery('render-case');
    const upper = await seedReleased(
      delivery,
      'approved_render',
      'VILLA RENDER.JPG',
    );
    expect(await listedAccess(delivery, upper)).toBe('preview');
  });
});

describe('everything else is unaffected', () => {
  it('leaves shop drawings and layouts downloadable while money is owed', async () => {
    // Only the BOQ and the 3D render are gated — Step 1's behaviour must not have
    // quietly changed for the rest of the pack.
    const delivery = await seedDelivery('others');
    const drawing = await seedReleased(delivery, 'shop_drawing', 'Sheet A-101.pdf');
    const layout = await seedReleased(delivery, 'autocad', 'Layout.dwg');
    const survey = await seedReleased(delivery, 'survey', 'Site survey.pdf');

    for (const id of [drawing, layout, survey]) {
      expect(await listedAccess(delivery, id)).toBe('download');
    }
  });

  it('treats a schedule with NOTHING owed as settled from the start', async () => {
    // An engagement whose milestones are all paid (or which has none) must not sit
    // behind a gate forever — same absent-milestone-is-a-free-gate rule the money
    // guards apply.
    const delivery = await seedDelivery('settled-early');
    await settleEverything(delivery);
    const boqId = await seedReleased(delivery, 'boq', 'Villa BOQ.xlsx');
    expect(await listedAccess(delivery, boqId)).toBe('download');
  });
});

describe('the settled test itself', () => {
  it('is false while any milestone is short and true when all are covered', async () => {
    const delivery = await seedDelivery('settled-fn');
    const settled = async (): Promise<boolean> => {
      const [row] = await raw.query<{ ok: boolean }>(
        `select public.app_engagement_payments_settled('${delivery.engagementId}') as ok`,
      );
      return row.ok;
    };
    expect(await settled()).toBe(false);
    await recordPaymentCore(delivery.ctx, {
      engagementId: delivery.engagementId,
      kind: 'deposit',
      amount: '40000',
    });
    expect(await settled()).toBe(false);
    await recordPaymentCore(delivery.ctx, {
      engagementId: delivery.engagementId,
      kind: 'gate_b',
      amount: '30000',
    });
    expect(await settled()).toBe(false);
    await recordPaymentCore(delivery.ctx, {
      engagementId: delivery.engagementId,
      kind: 'balance',
      amount: '30000',
    });
    expect(await settled()).toBe(true);
  });

  it('does not count a payment of the WRONG kind toward a milestone', async () => {
    // Kind isolation, mirroring the money guards: an over-large deposit does not
    // settle the balance.
    const delivery = await seedDelivery('settled-kind');
    await recordPaymentCore(delivery.ctx, {
      engagementId: delivery.engagementId,
      kind: 'deposit',
      amount: '100000',
    });
    const [row] = await raw.query<{ ok: boolean }>(
      `select public.app_engagement_payments_settled('${delivery.engagementId}') as ok`,
    );
    expect(row.ok).toBe(false);
  });
});
