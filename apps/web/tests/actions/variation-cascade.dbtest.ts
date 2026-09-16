import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import {
  createProposalCore,
  saveProposalDraftCore,
  sendProposalCore,
} from '@/lib/proposals/core';
import { respondToProposalByToken } from '@/lib/proposals/public';
import {
  generateContractCore,
  issueContractCore,
  terminateContractCore,
} from '@/lib/contracts/core';
import {
  createVariationDraftCore,
  internalApproveVariationCore,
  issueVariationCore,
  saveVariationDraftCore,
} from '@/lib/variations/core';
import { getVariationByToken, respondToVariationByToken } from '@/lib/variations/public';
import { listVariations } from '@/lib/variations/queries';
import { variationDecidedKey } from '@/lib/variations/decided-message';
import { variationStatusKey } from '@/lib/variations/status-label';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

// A10 — WHO rejected a variation order, against a real database.
//
// A VO reaches `rejected` by exactly two routes and they are different
// commercial facts: the CLIENT refused it, or the contract was TERMINATED under
// it. Before 0051 nothing recorded which, so the portal guessed from the parent
// contract's status — and told a client who HAD refused that they never decided.
// This suite drives both routes end to end and asserts the recorded channel, the
// client's sentence and the studio's pill.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const oneSection = [
  {
    titleEn: 'Works',
    lines: [
      {
        descriptionEn: 'Base',
        qty: '1',
        unit: 'lump_sum' as const,
        unitCost: '500',
        unitPrice: '1000',
        discountPct: '0',
        sortOrder: 0,
      },
    ],
  },
];

async function setup() {
  const { orgId, ownerIds } = await seedOrg({ owners: 1, members: [] });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    code: 'PRJ-1',
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  return { ctx, clientId: client.id, projectId: project.id };
}

/** An issued contract to hang variation orders off. */
async function issuedContract(ctx: OrgContext, clientId: string, projectId: string) {
  const proposalId = (
    (await createProposalCore(ctx, { clientId, projectId })) as { data?: string }
  ).data!;
  await saveProposalDraftCore(ctx, {
    id: proposalId,
    header: { taxRate: '14' },
    sections: oneSection,
  });
  const token = (await sendProposalCore(ctx, { id: proposalId })).data!;
  await respondToProposalByToken(token, { decision: 'accept' });
  const contractId = (
    (await generateContractCore(ctx, { proposalId })) as { data?: string }
  ).data!;
  await issueContractCore(ctx, { id: contractId });
  return contractId;
}

/** An ISSUED variation order and the client's share token for it. */
async function issuedVariation(ctx: OrgContext, contractId: string, title: string) {
  const id = (
    (await createVariationDraftCore(ctx, { contractId, titleEn: title })) as {
      data?: string;
    }
  ).data!;
  await saveVariationDraftCore(ctx, {
    id,
    lines: [
      {
        descriptionEn: 'x',
        qty: '1',
        unit: 'lump_sum',
        unitCost: '0',
        unitPrice: '100',
        discountPct: '0',
      },
    ],
  });
  const token = (
    (await internalApproveVariationCore(ctx, { id })) as { data?: string }
  ).data!;
  await issueVariationCore(ctx, { id });
  return { id, token };
}

/** Every `rejected` event on a VO, newest first — channel included. */
async function rejectionEvents(variationOrderId: string) {
  return raw.query<{ actor_channel: string | null; from_status: string }>(
    `select actor_channel, from_status from public.variation_order_events
       where variation_order_id = '${variationOrderId}' and kind = 'rejected'
       order by decided_at desc, id desc`,
  );
}

async function statusOf(variationOrderId: string): Promise<string> {
  const [row] = await raw.query<{ status: string }>(
    `select status from public.variation_orders where id = '${variationOrderId}'`,
  );
  return row.status;
}

describe('A10: the termination cascade records that IT rejected the VO', () => {
  it('leaves every open VO rejected with actor_channel = staff', async () => {
    const { ctx, clientId, projectId } = await setup();
    const contractId = await issuedContract(ctx, clientId, projectId);
    const open = await issuedVariation(ctx, contractId, 'Open when terminated');
    const secondOpen = await issuedVariation(ctx, contractId, 'Also open');

    expect((await terminateContractCore(ctx, { id: contractId })).ok).toBe(true);

    for (const vo of [open, secondOpen]) {
      expect(await statusOf(vo.id)).toBe('rejected');
      const events = await rejectionEvents(vo.id);
      expect(events).toHaveLength(1);
      // The cascade's own stamp. Without it the portal has to guess, and the
      // guess is wrong for the case below.
      expect(events[0].actor_channel).toBe('staff');
      expect(events[0].from_status).toBe('issued');
    }
  });

  it('the client sees a sentence that does not claim they decided it', async () => {
    const { ctx, clientId, projectId } = await setup();
    const contractId = await issuedContract(ctx, clientId, projectId);
    const vo = await issuedVariation(ctx, contractId, 'Closed with the contract');
    await terminateContractCore(ctx, { id: contractId });

    const read = await getVariationByToken(vo.token);
    expect(read?.status).toBe('rejected');
    expect(read?.contractActive).toBe(false);
    expect(read?.rejectionChannel).toBe('staff');
    expect(
      variationDecidedKey({
        status: read!.status,
        contractActive: read!.contractActive,
        outcome: null,
        rejectionChannel: read!.rejectionChannel,
      }),
    ).toBe('rejectedOnTermination');
  });

  it('the studio register paints it as bookkeeping, not as a refusal', async () => {
    const { ctx, clientId, projectId } = await setup();
    const contractId = await issuedContract(ctx, clientId, projectId);
    const vo = await issuedVariation(ctx, contractId, 'Register row');
    await terminateContractCore(ctx, { id: contractId });

    const [row] = await listVariations(ctx, { contractId });
    expect(row.id).toBe(vo.id);
    expect(row.rejectionChannel).toBe('staff');
    expect(variationStatusKey(row)).toBe('rejected_on_termination');
  });
});

describe('A10: a VO the client rejected is left alone by the cascade', () => {
  it('keeps the event the CLIENT wrote and is not re-rejected', async () => {
    const { ctx, clientId, projectId } = await setup();
    const contractId = await issuedContract(ctx, clientId, projectId);
    const refused = await issuedVariation(ctx, contractId, 'Client refused');
    expect(
      await respondToVariationByToken(refused.token, { decision: 'reject' }),
    ).toEqual({ ok: true });

    const beforeTermination = await rejectionEvents(refused.id);
    expect(beforeTermination).toHaveLength(1);
    expect(beforeTermination[0].actor_channel).toBe('client');

    expect((await terminateContractCore(ctx, { id: contractId })).ok).toBe(true);

    // ONE event, still the client's. `variationsToRejectOnTermination` skips an
    // already-decided VO, so the cascade must not append a second, staff-stamped
    // rejection over the top of the client's decision.
    const afterTermination = await rejectionEvents(refused.id);
    expect(afterTermination).toHaveLength(1);
    expect(afterTermination[0].actor_channel).toBe('client');
    expect(await statusOf(refused.id)).toBe('rejected');
  });

  it('THE FIX: the portal reads back their refusal, not "the contract is dead"', async () => {
    const { ctx, clientId, projectId } = await setup();
    const contractId = await issuedContract(ctx, clientId, projectId);
    const refused = await issuedVariation(ctx, contractId, 'Refused then terminated');
    await respondToVariationByToken(refused.token, { decision: 'reject' });
    await terminateContractCore(ctx, { id: contractId });

    const read = await getVariationByToken(refused.token);
    expect(read?.status).toBe('rejected');
    // The contract IS dead — that is not in dispute, and it is exactly what the
    // old ladder ranked first.
    expect(read?.contractActive).toBe(false);
    expect(read?.rejectionChannel).toBe('client');
    // ...and the client is nevertheless told what they themselves decided.
    expect(
      variationDecidedKey({
        status: read!.status,
        contractActive: read!.contractActive,
        outcome: null,
        rejectionChannel: read!.rejectionChannel,
      }),
    ).toBe('rejected');

    const [row] = await listVariations(ctx, { contractId });
    expect(variationStatusKey(row)).toBe('rejected');
  });
});

describe('A10: the client approval path also states its channel', () => {
  it('records actor_channel = client on an approval', async () => {
    const { ctx, clientId, projectId } = await setup();
    const contractId = await issuedContract(ctx, clientId, projectId);
    const vo = await issuedVariation(ctx, contractId, 'Client approved');
    expect(await respondToVariationByToken(vo.token, { decision: 'approve' })).toEqual({
      ok: true,
    });

    const [event] = await raw.query<{ actor_channel: string | null }>(
      `select actor_channel from public.variation_order_events
         where variation_order_id = '${vo.id}' and kind = 'approved'`,
    );
    expect(event.actor_channel).toBe('client');
  });
});
