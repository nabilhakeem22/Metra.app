import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import {
  createProposalCore,
  saveProposalDraftCore,
  sendProposalCore,
  type SaveDraftInput,
} from '@/lib/proposals/core';
import { respondToProposalByToken } from '@/lib/proposals/public';
import { generateContractCore, issueContractCore } from '@/lib/contracts/core';
import { getContractWithLines } from '@/lib/contracts/queries';
import {
  createVariationDraftCore,
  internalApproveVariationCore,
  issueVariationCore,
  saveVariationDraftCore,
} from '@/lib/variations/core';
import { respondToVariationByToken } from '@/lib/variations/public';
import {
  getProjectApprovedVariationTotal,
  getVariationWithLines,
} from '@/lib/variations/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';
import type { MemberRole } from '@metra/db';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const oneSection: SaveDraftInput['sections'] = [
  {
    titleEn: 'Civil',
    lines: [
      { descriptionEn: 'Wall', qty: '1', unit: 'lump_sum', unitCost: '600', unitPrice: '1000', discountPct: '0', sortOrder: 0 },
    ],
  },
];

async function setup(members: Array<{ role: MemberRole }> = []) {
  const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, { code: 'PRJ-1', nameEn: 'Tower', clientId: client.id, status: 'active' });
  const [project] = await listProjects(ctx, {});
  return { orgId, ctx, clientId: client.id, projectId: project.id, memberIds };
}

/** An issued contract (original value = 1140) and its id/project. */
async function issuedContract(ctx: OrgContext, clientId: string, projectId: string) {
  const pid = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
  await saveProposalDraftCore(ctx, { id: pid, header: { taxRate: '14' }, sections: oneSection });
  const token = (await sendProposalCore(ctx, { id: pid })).data!;
  await respondToProposalByToken(token, { decision: 'accept' });
  const contractId = ((await generateContractCore(ctx, { proposalId: pid })) as { data?: string }).data!;
  await issueContractCore(ctx, { id: contractId });
  return { contractId };
}

describe('variation draft save recomputes server-side (AC8)', () => {
  it('recomputes each line + netDelta; a negative de-scope yields a negative netDelta', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'Extra works' })) as { data?: string }).data!;

    const res = await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [
        { descriptionEn: 'Add doors', qty: '3', unit: 'pcs', unitCost: '100', unitPrice: '200', discountPct: '0' },
        { descriptionEn: 'Remove a wall', qty: '-1', unit: 'lump_sum', unitCost: '0', unitPrice: '150', discountPct: '0' },
      ],
    });
    expect(res.ok).toBe(true);
    const d = await getVariationWithLines(ctx, voId, true);
    // 3*200 - 150 = 450
    expect(d!.netDelta).toBe('450.0000');
    expect(d!.lines[0].lineTotal).toBe('600.0000');
    expect(d!.lines[1].lineTotal).toBe('-150.0000');
  });

  it('a fully negative VO yields a negative netDelta', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'De-scope' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [{ descriptionEn: 'Cut scope', qty: '-2', unit: 'lump_sum', unitCost: '0', unitPrice: '500', discountPct: '0' }],
    });
    const d = await getVariationWithLines(ctx, voId, true);
    expect(d!.netDelta).toBe('-1000.0000');
  });

  it('rejects creating a VO against a draft (non-issued) contract', async () => {
    const { ctx, clientId, projectId } = await setup();
    const pid = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id: pid, sections: oneSection });
    const token = (await sendProposalCore(ctx, { id: pid })).data!;
    await respondToProposalByToken(token, { decision: 'accept' });
    const contractId = ((await generateContractCore(ctx, { proposalId: pid })) as { data?: string }).data!;
    // contract still draft (never issued)
    expect(await createVariationDraftCore(ctx, { contractId, titleEn: 'x' })).toEqual({ ok: false, error: 'contract_not_issued' });
  });
});

describe('internal approval gate (AC8, AC10)', () => {
  it('owner can internal-approve; a PM and site_engineer cannot', async () => {
    const { orgId, ctx, clientId, projectId, memberIds } = await setup([
      { role: 'project_manager' },
      { role: 'site_engineer' },
    ]);
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const pm = ctxFor(orgId, memberIds[0], 'project_manager');
    const se = ctxFor(orgId, memberIds[1], 'site_engineer');

    const voId = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'VO' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [{ descriptionEn: 'x', qty: '1', unit: 'lump_sum', unitCost: '0', unitPrice: '500', discountPct: '0' }],
    });

    // PM can author/price the draft (variations_draft) but NOT internal-approve.
    expect(await internalApproveVariationCore(pm, { id: voId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await internalApproveVariationCore(se, { id: voId })).toMatchObject({ ok: false, error: 'forbidden' });
    // Owner can.
    const approved = await internalApproveVariationCore(ctx, { id: voId });
    expect(approved.ok).toBe(true);
    const [v] = await raw.query<{ status: string; net_delta: string }>(
      `select status, net_delta from public.variation_orders where id = '${voId}'`,
    );
    expect(v.status).toBe('internal_approved');
    expect(v.net_delta).toBe('500.0000');
  });

  it('AC10: a client-role session cannot internal-approve or issue', async () => {
    const { orgId, ctx, clientId, projectId, memberIds } = await setup([{ role: 'client' }]);
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const clientCtx = ctxFor(orgId, memberIds[0], 'client');
    const voId = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'VO' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [{ descriptionEn: 'x', qty: '1', unit: 'lump_sum', unitCost: '0', unitPrice: '500', discountPct: '0' }],
    });
    expect(await internalApproveVariationCore(clientCtx, { id: voId })).toMatchObject({ ok: false, error: 'forbidden' });
    await internalApproveVariationCore(ctx, { id: voId });
    expect(await issueVariationCore(clientCtx, { id: voId })).toMatchObject({ ok: false, error: 'forbidden' });
  });
});

describe('client decision via token + revised value (AC9)', () => {
  it('issued -> approved via token; revised value = original + Σ approved deltas; register total exact', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);

    // VO #1: +500, approved.
    const vo1 = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'Add' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, { id: vo1, lines: [{ descriptionEn: 'x', qty: '1', unit: 'lump_sum', unitCost: '0', unitPrice: '500', discountPct: '0' }] });
    const token1 = ((await internalApproveVariationCore(ctx, { id: vo1 })) as { data?: string }).data!;
    await issueVariationCore(ctx, { id: vo1 });
    const [v1before] = await raw.query<{ status: string }>(`select status from public.variation_orders where id = '${vo1}'`);
    expect(v1before.status).toBe('issued');
    const approve = await respondToVariationByToken(token1, { decision: 'approve', actorName: 'Client', ip: '9.9.9.9', userAgent: 'ua' });
    expect(approve).toEqual({ ok: true });
    const [v1] = await raw.query<{ status: string }>(`select status from public.variation_orders where id = '${vo1}'`);
    expect(v1.status).toBe('approved');
    // 2nd response -> already.
    expect(await respondToVariationByToken(token1, { decision: 'reject' })).toEqual({ ok: false, error: 'already_responded' });

    // VO #2: -200, rejected by the client (must NOT move the revised value).
    const vo2 = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'Cut' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, { id: vo2, lines: [{ descriptionEn: 'y', qty: '-1', unit: 'lump_sum', unitCost: '0', unitPrice: '200', discountPct: '0' }] });
    const token2 = ((await internalApproveVariationCore(ctx, { id: vo2 })) as { data?: string }).data!;
    await issueVariationCore(ctx, { id: vo2 });
    await respondToVariationByToken(token2, { decision: 'reject' });

    // Revised value = 1140 (original) + 500 (only the approved VO).
    const detail = await getContractWithLines(ctx, contractId, true);
    expect(detail!.originalValue).toBe('1140.0000');
    expect(detail!.revisedValue).toBe('1640.0000');

    // Per-project approved-VO register total = exactly Σ approved deltas = 500.
    const total = await getProjectApprovedVariationTotal(ctx, projectId);
    expect(total).toBe('500.0000');
  });

  it('token payload carries no cost/margin (AC11 for VOs)', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const vo = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'VO' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, { id: vo, lines: [{ descriptionEn: 'x', qty: '1', unit: 'lump_sum', unitCost: '333', unitPrice: '500', discountPct: '0' }] });
    const token = ((await internalApproveVariationCore(ctx, { id: vo })) as { data?: string }).data!;
    await issueVariationCore(ctx, { id: vo });
    const { getVariationByToken } = await import('@/lib/variations/public');
    const payload = await getVariationByToken(token);
    expect(payload).not.toBeNull();
    expect(JSON.stringify(payload)).not.toMatch(/unit_cost|line_cost|line_margin|total_cost|total_margin/i);
  });
});

describe('R1: netDelta freeze is atomic with the lines', () => {
  async function lineSum(voId: string): Promise<string> {
    const [row] = await raw.query<{ s: string }>(
      `select coalesce(sum(line_total), 0)::text as s from public.variation_order_lines where variation_order_id = '${voId}'`,
    );
    return row.s;
  }

  it('a line rewrite racing internal-approval leaves net_delta == the committed line sum', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'Race' })) as { data?: string }).data!;
    // Initial lines sum to 100.
    await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [{ descriptionEn: 'x', qty: '1', unit: 'lump_sum', unitCost: '0', unitPrice: '100', discountPct: '0' }],
    });

    // Race a rewrite to 999 against the internal approval. Whatever the ordering,
    // the row lock serializes them and the frozen net_delta must equal the lines.
    const [saveRes, approveRes] = await Promise.all([
      saveVariationDraftCore(ctx, {
        id: voId,
        lines: [{ descriptionEn: 'x', qty: '1', unit: 'lump_sum', unitCost: '0', unitPrice: '999', discountPct: '0' }],
      }),
      internalApproveVariationCore(ctx, { id: voId }),
    ]);
    // The approval always wins its gate (or fails if the save left it non-draft —
    // but the save can't advance status, so approval succeeds).
    expect(approveRes.ok).toBe(true);
    // If the save lost the race (VO already internal_approved), it must say so and
    // NOT have mutated the frozen lines.
    if (!saveRes.ok) expect(saveRes.error).toBe('variation_not_draft');

    const [vo] = await raw.query<{ net_delta: string }>(
      `select net_delta from public.variation_orders where id = '${voId}'`,
    );
    // The invariant: frozen net_delta == the committed line sum, to the piastre.
    expect(Number(vo.net_delta)).toBe(Number(await lineSum(voId)));
  });

  it('saving a draft after it left draft returns variation_not_draft', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'Gate' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [{ descriptionEn: 'x', qty: '1', unit: 'lump_sum', unitCost: '0', unitPrice: '100', discountPct: '0' }],
    });
    await internalApproveVariationCore(ctx, { id: voId });
    // The VO is now internal_approved (frozen). A late save must be rejected, not
    // silently reported ok while affecting 0 rows.
    expect(
      await saveVariationDraftCore(ctx, {
        id: voId,
        lines: [{ descriptionEn: 'y', qty: '5', unit: 'lump_sum', unitCost: '0', unitPrice: '50', discountPct: '0' }],
      }),
    ).toEqual({ ok: false, error: 'variation_not_draft' });
  });
});

describe('F1: a de-scope reverses an add to the piastre', () => {
  it('a +VO then an identical −VO nets the revised value to baseline and the register to 0', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);

    // A half-rounding price so the add/reverse would drift a piastre under
    // asymmetric rounding. +VO of qty 1 @ 0.3333 with 50% discount.
    const line = { descriptionEn: 'x', qty: '1', unit: 'lump_sum' as const, unitCost: '0', unitPrice: '0.3333', discountPct: '50' };
    const addVo = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'Add' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, { id: addVo, lines: [line] });
    const t1 = ((await internalApproveVariationCore(ctx, { id: addVo })) as { data?: string }).data!;
    await issueVariationCore(ctx, { id: addVo });
    await respondToVariationByToken(t1, { decision: 'approve' });

    const cutVo = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'Cut' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, { id: cutVo, lines: [{ ...line, qty: '-1' }] });
    const t2 = ((await internalApproveVariationCore(ctx, { id: cutVo })) as { data?: string }).data!;
    await issueVariationCore(ctx, { id: cutVo });
    await respondToVariationByToken(t2, { decision: 'approve' });

    // Revised value back to the original baseline, and the register nets to 0.
    const detail = await getContractWithLines(ctx, contractId, true);
    expect(detail!.revisedValue).toBe(detail!.originalValue);
    expect(await getProjectApprovedVariationTotal(ctx, projectId)).toBe('0.0000');
  });
});
