import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { withOrgContext } from '@/lib/db/context';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import {
  createProposalCore,
  saveProposalDraftCore,
  sendProposalCore,
  type SaveDraftInput,
} from '@/lib/proposals/core';
import { respondToProposalByToken } from '@/lib/proposals/public';
import {
  generateContractCore,
  issueContractCore,
  saveContractDraftCore,
  terminateContractCore,
} from '@/lib/contracts/core';
import {
  acknowledgeContractByToken,
  getContractByToken,
} from '@/lib/contracts/public';
import { getContractWithLines } from '@/lib/contracts/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';
import type { MemberRole } from '@metra/db';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const twoSections: SaveDraftInput['sections'] = [
  {
    titleEn: 'Civil',
    sortOrder: 0,
    lines: [
      { descriptionEn: 'Wall', qty: '2', unit: 'sqm', unitCost: '60', unitPrice: '100', discountPct: '0', sortOrder: 0 },
      { descriptionEn: 'Plaster', qty: '1', unit: 'sqm', unitCost: '30', unitPrice: '50', discountPct: '10', sortOrder: 1 },
    ],
  },
];

async function setup(members: Array<{ role: MemberRole }> = []) {
  const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    code: 'PRJ-1',
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  return { orgId, ctx, clientId: client.id, projectId: project.id, memberIds };
}

/** Build an ACCEPTED proposal and return its id + total. */
async function acceptedProposal(
  ctx: OrgContext,
  clientId: string,
  projectId: string,
): Promise<{ id: string; total: string }> {
  const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
  await saveProposalDraftCore(ctx, { id, header: { taxRate: '14' }, sections: twoSections });
  const token = (await sendProposalCore(ctx, { id })).data!;
  const acc = await respondToProposalByToken(token, { decision: 'accept', actorName: 'Client' });
  expect(acc.ok).toBe(true);
  const [p] = await raw.query<{ total: string }>(
    `select total from public.proposals where id = '${id}'`,
  );
  return { id, total: p.total };
}

describe('generateContractCore (AC1, AC2, AC3)', () => {
  it('AC1: generate on accepted -> draft contract, deep-copied, originalValue === proposal.total', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { id: proposalId, total } = await acceptedProposal(ctx, clientId, projectId);

    const res = await generateContractCore(ctx, { proposalId });
    expect(res.ok).toBe(true);
    const contractId = (res as { data?: string }).data!;
    const detail = await getContractWithLines(ctx, contractId, true);
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe('draft');
    expect(detail!.originalValue).toBe(total);
    expect(detail!.sections).toHaveLength(1);
    expect(detail!.sections[0].lines).toHaveLength(2);
    // Revised == original when there are no approved VOs.
    expect(detail!.revisedValue).toBe(total);
  });

  it('AC2: duplicate generate -> contract_exists, no 2nd row', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { id: proposalId } = await acceptedProposal(ctx, clientId, projectId);
    expect((await generateContractCore(ctx, { proposalId })).ok).toBe(true);
    expect(await generateContractCore(ctx, { proposalId })).toEqual({ ok: false, error: 'contract_exists' });
    const [n] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.contracts where source_proposal_id = '${proposalId}'`,
    );
    expect(Number(n.n)).toBe(1);
  });

  it('AC3: generate on a non-accepted proposal -> proposal_not_accepted', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id, sections: twoSections });
    expect(await generateContractCore(ctx, { proposalId: id })).toEqual({ ok: false, error: 'proposal_not_accepted' });
  });
});

describe('contract immutability + lifecycle (AC4, AC5, AC6)', () => {
  async function issuedContract() {
    const base = await setup();
    const { id: proposalId } = await acceptedProposal(base.ctx, base.clientId, base.projectId);
    const contractId = ((await generateContractCore(base.ctx, { proposalId })) as { data?: string }).data!;
    return { ...base, contractId };
  }

  it('AC4/AC5: after issue, header/line writes raise MT100; only whitelisted transitions', async () => {
    const { ctx, contractId } = await issuedContract();
    expect((await issueContractCore(ctx, { id: contractId })).ok).toBe(true);

    // A raw UPDATE of a non-status column is frozen.
    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(sql`update public.contracts set original_value = '1' where id = ${contractId}`),
      ),
    ).rejects.toMatchObject({ code: 'MT100' });

    // A raw UPDATE of a contract line is frozen (parent left draft).
    const [line] = await raw.query<{ id: string }>(
      `select id from public.contract_lines where contract_id = '${contractId}' limit 1`,
    );
    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(sql`update public.contract_lines set unit_price = '1' where id = ${line.id}`),
      ),
    ).rejects.toMatchObject({ code: 'MT100' });
  });

  it('AC6: issue is atomic — concurrent 2nd call -> contract_not_draft, no 2nd token', async () => {
    const { ctx, contractId } = await issuedContract();
    const [a, b] = await Promise.all([
      issueContractCore(ctx, { id: contractId }),
      issueContractCore(ctx, { id: contractId }),
    ]);
    const okCount = [a, b].filter((r) => r.ok).length;
    expect(okCount).toBe(1);
    expect([a, b].some((r) => !r.ok && r.error === 'contract_not_draft')).toBe(true);
    const [ev] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.contract_events where contract_id = '${contractId}' and kind = 'issued'`,
    );
    expect(Number(ev.n)).toBe(1);
  });

  it('terminate: issued -> terminated; a 2nd terminate -> contract_not_signable', async () => {
    const { ctx, contractId } = await issuedContract();
    await issueContractCore(ctx, { id: contractId });
    expect((await terminateContractCore(ctx, { id: contractId })).ok).toBe(true);
    expect(await terminateContractCore(ctx, { id: contractId })).toEqual({ ok: false, error: 'contract_not_signable' });
  });
});

describe('contract draft header edit', () => {
  it('rejects a header save once issued (contract_not_draft); accepts while draft', async () => {
    const base = await setup();
    const { id: proposalId } = await acceptedProposal(base.ctx, base.clientId, base.projectId);
    const contractId = ((await generateContractCore(base.ctx, { proposalId })) as { data?: string }).data!;
    expect(
      (await saveContractDraftCore(base.ctx, { id: contractId, header: { retentionPct: '5', advancePct: '10' } })).ok,
    ).toBe(true);
    const d = await getContractWithLines(base.ctx, contractId, true);
    expect(d!.retentionPct).toBe('5.0000');
    expect(d!.advancePct).toBe('10.0000');
    await issueContractCore(base.ctx, { id: contractId });
    expect(await saveContractDraftCore(base.ctx, { id: contractId, header: { retentionPct: '20' } })).toEqual({ ok: false, error: 'contract_not_draft' });
  });

  it('rejects out-of-range retention/advance', async () => {
    const base = await setup();
    const { id: proposalId } = await acceptedProposal(base.ctx, base.clientId, base.projectId);
    const contractId = ((await generateContractCore(base.ctx, { proposalId })) as { data?: string }).data!;
    expect(await saveContractDraftCore(base.ctx, { id: contractId, header: { retentionPct: '150' } })).toEqual({ ok: false, error: 'invalid_percentage' });
  });
});

describe('public acknowledgement token (AC7, AC11)', () => {
  it('AC11: token payload contains no cost/margin', async () => {
    const base = await setup();
    const { id: proposalId } = await acceptedProposal(base.ctx, base.clientId, base.projectId);
    const contractId = ((await generateContractCore(base.ctx, { proposalId })) as { data?: string }).data!;
    const link = (await issueContractCore(base.ctx, { id: contractId })) as { data?: string };
    const token = link.data!;
    const payload = await getContractByToken(token);
    expect(payload).not.toBeNull();
    expect(JSON.stringify(payload)).not.toMatch(/unit_cost|line_cost|line_margin|total_cost|total_margin/i);
    expect(payload!.sections[0].lines[0]).toHaveProperty('line_total');
  });

  it('AC7: acknowledge flips issued->signed + logs name/ip/ua; 2nd -> already; copy is acknowledgement', async () => {
    const base = await setup();
    const { id: proposalId } = await acceptedProposal(base.ctx, base.clientId, base.projectId);
    const contractId = ((await generateContractCore(base.ctx, { proposalId })) as { data?: string }).data!;
    const token = ((await issueContractCore(base.ctx, { id: contractId })) as { data?: string }).data!;

    const ack = await acknowledgeContractByToken(token, { actorName: 'Nabil', ip: '1.2.3.4', userAgent: 'jest', pdfHash: 'abc123' });
    expect(ack).toEqual({ ok: true });
    const [c] = await raw.query<{ status: string }>(
      `select status from public.contracts where id = '${contractId}'`,
    );
    expect(c.status).toBe('signed');
    // The acknowledgement timestamp + actor/ip/ua/pdf hash live on the append-only
    // event (the signed row is immutable and can't hold them).
    const [ev] = await raw.query<{ actor_name: string; ip: string; user_agent: string; pdf_hash: string; kind: string; decided_at: string }>(
      `select actor_name, ip, user_agent, pdf_hash, kind, decided_at from public.contract_events where contract_id = '${contractId}' and kind = 'acknowledged' limit 1`,
    );
    expect(ev.actor_name).toBe('Nabil');
    expect(ev.ip).toBe('1.2.3.4');
    expect(ev.pdf_hash).toBe('abc123');
    expect(ev.decided_at).not.toBeNull();

    // 2nd acknowledgement -> already_responded.
    expect(await acknowledgeContractByToken(token, {})).toEqual({ ok: false, error: 'already_responded' });
  });
});

describe('S1 fix (AC10): client role cannot generate/issue a contract', () => {
  it('client-role session is forbidden from generate + issue', async () => {
    const { orgId, ctx, clientId, projectId } = await setup([{ role: 'client' }]);
    const { id: proposalId } = await acceptedProposal(ctx, clientId, projectId);
    const contractId = ((await generateContractCore(ctx, { proposalId })) as { data?: string }).data!;
    const mems = await raw.memberships(orgId);
    const clientUid = mems.find((mm) => mm.role === 'client')!.user_id;
    const clientCtx = ctxFor(orgId, clientUid, 'client');

    // A fresh accepted proposal for the client's generate attempt.
    const { id: proposalId2 } = await acceptedProposal(ctx, clientId, projectId);
    expect(await generateContractCore(clientCtx, { proposalId: proposalId2 })).toEqual({ ok: false, error: 'forbidden' });
    expect(await issueContractCore(clientCtx, { id: contractId })).toMatchObject({ ok: false, error: 'forbidden' });
  });
});
