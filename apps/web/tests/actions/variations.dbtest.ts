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
import {
  generateContractCore,
  issueContractCore,
  terminateContractCore,
} from '@/lib/contracts/core';
import { getContractWithLines } from '@/lib/contracts/queries';
import {
  createVariationDraftCore,
  internalApproveVariationCore,
  issueVariationCore,
  saveVariationDraftCore,
} from '@/lib/variations/core';
import { getVariationByToken, respondToVariationByToken } from '@/lib/variations/public';
import { computeVariationNetDelta } from '@/lib/aggregates/contract-value';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';
import type { MemberRole } from '@metra/db';

// Read-back instruments.
//
// `lib/variations/queries` used to export a `getVariationWithLines` and a
// per-project approved-total query, and this suite was their ONLY caller —
// nothing in the product read either one, because the register on the contract
// detail page is the only variation surface that exists. The dead queries are
// gone; the read-back is what it always was underneath, a direct select. Every
// assertion below is unchanged.
async function readSavedVariation(
  variationOrderId: string,
): Promise<{ netDelta: string; lineTotals: string[] }> {
  const [header] = await raw.query<{ net_delta: string }>(
    `select net_delta from public.variation_orders where id = '${variationOrderId}'`,
  );
  const lines = await raw.query<{ line_total: string }>(
    `select line_total from public.variation_order_lines` +
      ` where variation_order_id = '${variationOrderId}' order by sort_order asc`,
  );
  return { netDelta: header.net_delta, lineTotals: lines.map((l) => l.line_total) };
}

/** Sigma netDelta of the APPROVED VOs for a project — the register's bottom line.
 *  The same pure aggregate the deleted query used, over the same rows. */
async function approvedVariationTotal(projectId: string): Promise<string> {
  const rows = await raw.query<{ net_delta: string }>(
    `select net_delta from public.variation_orders` +
      ` where project_id = '${projectId}' and status = 'approved'`,
  );
  return computeVariationNetDelta(
    rows.map((r) => ({ lineCost: '0', lineTotal: r.net_delta, lineMargin: '0' })),
  );
}

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
  await createProjectCore(ctx, { startDate: '2026-01-01', endDate: '2026-06-30', code: 'PRJ-1', nameEn: 'Tower', clientId: client.id, status: 'active' });
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
    const saved = await readSavedVariation(voId);
    // 3*200 - 150 = 450
    expect(saved.netDelta).toBe('450.0000');
    expect(saved.lineTotals[0]).toBe('600.0000');
    expect(saved.lineTotals[1]).toBe('-150.0000');
  });

  it('a fully negative VO yields a negative netDelta', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'De-scope' })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [{ descriptionEn: 'Cut scope', qty: '-2', unit: 'lump_sum', unitCost: '0', unitPrice: '500', discountPct: '0' }],
    });
    expect((await readSavedVariation(voId)).netDelta).toBe('-1000.0000');
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
    const total = await approvedVariationTotal(projectId);
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
    expect(await approvedVariationTotal(projectId)).toBe('0.0000');
  });
});

describe('M10: a variation total past the money cap is coded, not generic', () => {
  it('refuses a line whose qty x price overflows, and a netDelta that does', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, { contractId, titleEn: 'Huge' })) as { data?: string }).data!;

    // A FACTOR past the cap is its own answer. It used to be a bare 'invalid',
    // which tells a studio looking at a quantity of 1e13 nothing it can act on.
    expect(
      await saveVariationDraftCore(ctx, {
        id: voId,
        lines: [{ descriptionEn: 'x', qty: '10000000000000', unit: 'lump_sum', unitCost: '0', unitPrice: '1', discountPct: '0' }],
      }),
    ).toEqual({ ok: false, error: 'amount_too_large' });
    // ...and a cell that is not a number at all still answers 'invalid'.
    expect(
      await saveVariationDraftCore(ctx, {
        id: voId,
        lines: [{ descriptionEn: 'x', qty: 'twelve', unit: 'lump_sum', unitCost: '0', unitPrice: '1', discountPct: '0' }],
      }),
    ).toEqual({ ok: false, error: 'invalid' });

    // Each factor is inside the cap; the product is not.
    expect(
      await saveVariationDraftCore(ctx, {
        id: voId,
        lines: [{ descriptionEn: 'x', qty: '1000000000000', unit: 'lump_sum', unitCost: '0', unitPrice: '1000000000000', discountPct: '0' }],
      }),
    ).toEqual({ ok: false, error: 'amount_too_large' });

    // The cost side alone: the price is nominal, the cost is not.
    expect(
      await saveVariationDraftCore(ctx, {
        id: voId,
        lines: [{ descriptionEn: 'x', qty: '1000000000000', unit: 'lump_sum', unitCost: '1000000000000', unitPrice: '0.0001', discountPct: '0' }],
      }),
    ).toEqual({ ok: false, error: 'amount_too_large' });

    // Each line is inside the cap; their sum is not.
    expect(
      await saveVariationDraftCore(ctx, {
        id: voId,
        lines: Array.from({ length: 3 }, () => ({
          descriptionEn: 'x', qty: '1', unit: 'lump_sum' as const,
          unitCost: '0', unitPrice: '900000000000', discountPct: '0',
        })),
      }),
    ).toEqual({ ok: false, error: 'amount_too_large' });
  });
});

describe('B2: a terminated contract carries no commercial change', () => {
  /** A draft VO with one 100 EGP line on a fresh issued contract. */
  async function draftVariation(ctx: OrgContext, contractId: string, title: string) {
    const voId = ((await createVariationDraftCore(ctx, { contractId, titleEn: title })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [{ descriptionEn: 'x', qty: '1', unit: 'lump_sum', unitCost: '0', unitPrice: '100', discountPct: '0' }],
    });
    return voId;
  }

  async function statusOf(voId: string): Promise<string> {
    const [row] = await raw.query<{ status: string }>(
      `select status from public.variation_orders where id = '${voId}'`,
    );
    return row.status;
  }

  it('refuses internal approval of a draft VO and mints no token', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = await draftVariation(ctx, contractId, 'Late approval');
    // Terminate WITHOUT the cascade so the VO is still draft: this asserts the
    // internal-approval guard itself, not the auto-rejection (covered below).
    await raw.query(
      `update public.contracts set status = 'terminated' where id = '${contractId}'`,
    );

    expect(await internalApproveVariationCore(ctx, { id: voId })).toEqual({
      ok: false,
      error: 'contract_not_issued',
    });
    const [vo] = await raw.query<{ status: string; token_hash: string | null }>(
      `select status, token_hash from public.variation_orders where id = '${voId}'`,
    );
    expect(vo.status).toBe('draft');
    expect(vo.token_hash).toBeNull();
  });

  it('refuses to issue an internally approved VO and writes no event', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = await draftVariation(ctx, contractId, 'Late issue');
    await internalApproveVariationCore(ctx, { id: voId });
    // Terminate WITHOUT the cascade so the VO is still internal_approved: this
    // asserts the issue guard itself, not the auto-rejection.
    await raw.query(
      `update public.contracts set status = 'terminated' where id = '${contractId}'`,
    );

    expect(await issueVariationCore(ctx, { id: voId })).toEqual({
      ok: false,
      error: 'contract_not_issued',
    });
    expect(await statusOf(voId)).toBe('internal_approved');
    const [events] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.variation_order_events
         where variation_order_id = '${voId}' and kind = 'issued'`,
    );
    expect(events.n).toBe(0);
  });

  it('refuses the client token decision with contract_inactive', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = await draftVariation(ctx, contractId, 'Token decision');
    const token = ((await internalApproveVariationCore(ctx, { id: voId })) as { data?: string }).data!;
    await issueVariationCore(ctx, { id: voId });
    // Again without the cascade, so the SDF is proved to be a second line of
    // defence for any VO left issued under a dead contract.
    await raw.query(
      `update public.contracts set status = 'terminated' where id = '${contractId}'`,
    );

    expect(await respondToVariationByToken(token, { decision: 'approve' })).toEqual({
      ok: false,
      error: 'contract_inactive',
    });
    expect(await statusOf(voId)).toBe('issued');
  });

  it('tells the token reader the contract died rather than that the client rejected', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = await draftVariation(ctx, contractId, 'Terminated read');
    const token = ((await internalApproveVariationCore(ctx, { id: voId })) as { data?: string }).data!;
    await issueVariationCore(ctx, { id: voId });

    const live = await getVariationByToken(token);
    expect(live?.status).toBe('issued');
    expect(live?.contractActive).toBe(true);

    expect((await terminateContractCore(ctx, { id: contractId })).ok).toBe(true);

    // The cascade rejected the VO, but the client never did: the portal picks its
    // copy from contractActive, so the read must carry the parent's real state.
    const afterTermination = await getVariationByToken(token);
    expect(afterTermination?.status).toBe('rejected');
    expect(afterTermination?.contractActive).toBe(false);
  });

  it('rejects every undecided VO on termination and leaves an approved one alone', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);

    const draftVo = await draftVariation(ctx, contractId, 'Still draft');
    const approvedInternallyVo = await draftVariation(ctx, contractId, 'Internally approved');
    await internalApproveVariationCore(ctx, { id: approvedInternallyVo });
    const issuedVo = await draftVariation(ctx, contractId, 'Issued');
    await internalApproveVariationCore(ctx, { id: issuedVo });
    await issueVariationCore(ctx, { id: issuedVo });
    const decidedVo = await draftVariation(ctx, contractId, 'Client approved');
    const decidedToken = ((await internalApproveVariationCore(ctx, { id: decidedVo })) as { data?: string }).data!;
    await issueVariationCore(ctx, { id: decidedVo });
    await respondToVariationByToken(decidedToken, { decision: 'approve' });

    // No MT100: the cascade sets status + updated_at only.
    expect((await terminateContractCore(ctx, { id: contractId })).ok).toBe(true);

    expect(await statusOf(draftVo)).toBe('rejected');
    expect(await statusOf(approvedInternallyVo)).toBe('rejected');
    expect(await statusOf(issuedVo)).toBe('rejected');
    expect(await statusOf(decidedVo)).toBe('approved');

    const events = await raw.query<{ variation_order_id: string; from_status: string }>(
      `select variation_order_id, from_status from public.variation_order_events
         where variation_order_id in ('${draftVo}', '${approvedInternallyVo}', '${issuedVo}', '${decidedVo}')
           and kind = 'rejected' order by from_status`,
    );
    expect(events).toEqual([
      { variation_order_id: draftVo, from_status: 'draft' },
      { variation_order_id: approvedInternallyVo, from_status: 'internal_approved' },
      { variation_order_id: issuedVo, from_status: 'issued' },
    ]);
  });
});
