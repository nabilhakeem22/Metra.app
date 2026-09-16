// The concurrency gates: every state transition is an atomic admission gate
// (`UPDATE ... WHERE status=... RETURNING`, rowCount checked), and this is what
// proves it under two callers rather than one.
//
// Written by the wave-3 reliability review, which could not run it: a real
// Postgres exists only in CI (`npm run test:actions -w @metra/web`,
// .github/workflows/ci.yml "action-core DB tests"). NEVER run it locally — the
// developer DATABASE_URL is the shared hosted database, and these cases create
// and delete whole organisations.
//
// Every case races two callers at the SAME row, which no other dbtest does: the
// rest run one call at a time, so a gate that had quietly become a read-then-
// write would pass all of them. Wave 3's G3 moved each of those gating UPDATEs
// into its own named phase, which is the change these exist to check.
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import {
  createProposalCore,
  saveProposalDraftCore,
  type SaveDraftInput,
} from '@/lib/proposals/core';
import { sendProposalCore, supersedeProposalCore } from '@/lib/proposals/lifecycle';
import { persistDraftHeaderAndTotals } from '@/lib/proposals/core/draft-save-persist';
import { respondToProposalByToken } from '@/lib/proposals/public';
import {
  generateContractCore,
  issueContractCore,
  terminateContractCore,
} from '@/lib/contracts/core';
import {
  createVariationDraftCore,
  internalApproveVariationCore,
  saveVariationDraftCore,
} from '@/lib/variations/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const oneSection: SaveDraftInput['sections'] = [
  {
    titleEn: 'Civil',
    lines: [
      {
        descriptionEn: 'Wall',
        qty: '1',
        unit: 'lump_sum',
        unitCost: '600',
        unitPrice: '1000',
        discountPct: '0',
        sortOrder: 0,
      },
    ],
  },
];

async function setup() {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
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
  return { orgId, ctx, clientId: client.id, projectId: project.id };
}

async function sentProposal(ctx: OrgContext, clientId: string, projectId: string) {
  const id = ((await createProposalCore(ctx, { clientId, projectId })) as {
    data?: string;
  }).data!;
  await saveProposalDraftCore(ctx, { id, sections: oneSection });
  const token = (await sendProposalCore(ctx, { id })).data!;
  return { id, token };
}

async function issuedContract(ctx: OrgContext, clientId: string, projectId: string) {
  const { id, token } = await sentProposal(ctx, clientId, projectId);
  await respondToProposalByToken(token, { decision: 'accept' });
  const contractId = ((await generateContractCore(ctx, { proposalId: id })) as {
    data?: string;
  }).data!;
  await issueContractCore(ctx, { id: contractId });
  return { proposalId: id, contractId };
}

function okCount(results: Array<{ ok: boolean }>): number {
  return results.filter((r) => r.ok).length;
}

// R-A  internal approval: the freeze is ONE statement, and it happens ONCE.
describe('R-A internalApproveVariationCore under concurrency', () => {
  it('two concurrent approvals: one wins, net_delta = sum(line_total)', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, {
      contractId,
      titleEn: 'Extra works',
    })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [
        { descriptionEn: 'Doors', qty: '3', unit: 'pcs', unitCost: '100', unitPrice: '200', discountPct: '0' },
        { descriptionEn: 'Frames', qty: '2', unit: 'pcs', unitCost: '50', unitPrice: '125', discountPct: '0' },
      ],
    });

    const [a, b] = await Promise.all([
      internalApproveVariationCore(ctx, { id: voId }),
      internalApproveVariationCore(ctx, { id: voId }),
    ]);
    expect(okCount([a, b])).toBe(1);
    // The loser must be a CODED refusal, never `generic`.
    expect((a.ok ? b : a).error).toBe('variation_not_draft');

    const [header] = await raw.query<{ net_delta: string; status: string }>(
      `select net_delta, status from public.variation_orders where id = '${voId}'`,
    );
    const [sum] = await raw.query<{ total: string }>(
      `select coalesce(sum(line_total), 0)::text as total from public.variation_order_lines where variation_order_id = '${voId}'`,
    );
    expect(header.status).toBe('internal_approved');
    expect(Number(header.net_delta)).toBe(Number(sum.total)); // 3*200 + 2*125 = 850
    const events = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.variation_order_events where variation_order_id = '${voId}' and kind = 'internal_approved'`,
    );
    expect(events[0].n).toBe(1);
  });

  it('R1: a line rewrite racing an approval cannot make net_delta disagree with the lines', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, {
      contractId,
      titleEn: 'Racing edit',
    })) as { data?: string }).data!;
    await saveVariationDraftCore(ctx, {
      id: voId,
      lines: [{ descriptionEn: 'A', qty: '1', unit: 'pcs', unitCost: '10', unitPrice: '100', discountPct: '0' }],
    });

    // The VO row lock (lockDraftVariation FOR UPDATE in
    // lifecycle/internal-approve-gate.ts; loadDraftVariationForUpdate in
    // core/update.ts) is the serialization point.
    const [save, approve] = await Promise.all([
      saveVariationDraftCore(ctx, {
        id: voId,
        lines: [
          { descriptionEn: 'A', qty: '1', unit: 'pcs', unitCost: '10', unitPrice: '100', discountPct: '0' },
          { descriptionEn: 'B', qty: '4', unit: 'pcs', unitCost: '10', unitPrice: '50', discountPct: '0' },
        ],
      }),
      internalApproveVariationCore(ctx, { id: voId }),
    ]);

    const [header] = await raw.query<{ net_delta: string; status: string }>(
      `select net_delta, status from public.variation_orders where id = '${voId}'`,
    );
    const [sum] = await raw.query<{ total: string }>(
      `select coalesce(sum(line_total), 0)::text as total from public.variation_order_lines where variation_order_id = '${voId}'`,
    );
    // THE INVARIANT. Holds whichever won.
    expect(Number(header.net_delta)).toBe(Number(sum.total));
    if (header.status === 'internal_approved') expect(approve.ok).toBe(true);
    if (save.ok) expect(['draft', 'internal_approved']).toContain(header.status);
  });
});

// R-B  the proposal transitions: one gating UPDATE, one effect.
describe('R-B proposal transitions under concurrency', () => {
  it('two concurrent sends: one token, one sent event, one feed entry', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as {
      data?: string;
    }).data!;
    await saveProposalDraftCore(ctx, { id, sections: oneSection });

    const [a, b] = await Promise.all([
      sendProposalCore(ctx, { id }),
      sendProposalCore(ctx, { id }),
    ]);
    expect(okCount([a, b])).toBe(1);
    expect((a.ok ? b : a).error).toBe('proposal_not_draft');

    const events = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.proposal_events where proposal_id = '${id}' and kind = 'sent'`,
    );
    expect(events[0].n).toBe(1);
    const [row] = await raw.query<{ token_hash: string }>(
      `select token_hash from public.proposals where id = '${id}'`,
    );
    expect(row.token_hash).toHaveLength(64);
    const feed = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.activities where kind = 'proposal_sent' and meta->>'proposal_id' = '${id}'`,
    );
    expect(feed[0].n).toBe(1);
  });

  it('two concurrent supersedes: one revision, and it inherits no client state', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { id } = await sentProposal(ctx, clientId, projectId);

    const [a, b] = await Promise.all([
      supersedeProposalCore(ctx, { id }),
      supersedeProposalCore(ctx, { id }),
    ]);
    expect(okCount([a, b])).toBe(1);

    const copies = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.proposals where supersedes_id = '${id}'`,
    );
    expect(copies[0].n).toBe(1);
    const [copy] = await raw.query<{ token_hash: string | null; share_expires_at: string | null; status: string }>(
      `select token_hash, share_expires_at, status from public.proposals where supersedes_id = '${id}'`,
    );
    expect(copy.token_hash).toBeNull();
    expect(copy.share_expires_at).toBeNull();
    expect(copy.status).toBe('draft');
    const lines = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.proposal_lines where proposal_id = (select id from public.proposals where supersedes_id = '${id}')`,
    );
    expect(lines[0].n).toBe(1);
  });

  it('allocateNumber: ten concurrent creates get ten distinct numbers', async () => {
    const { ctx, clientId, projectId } = await setup();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createProposalCore(ctx, { clientId, projectId })),
    );
    expect(okCount(results as Array<{ ok: boolean }>)).toBe(10);
    const numbers = await raw.query<{ number: number }>(
      `select number from public.proposals where project_id = '${projectId}' order by number`,
    );
    expect(new Set(numbers.map((n) => n.number)).size).toBe(numbers.length);
  });
});

// R-C  the proposals draft save and the send, at the same row.
describe('R-C a draft save racing a send', () => {
  it('never leaves a half-written proposal', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as {
      data?: string;
    }).data!;
    await saveProposalDraftCore(ctx, { id, sections: oneSection });

    const [save, send] = await Promise.all([
      saveProposalDraftCore(ctx, {
        id,
        header: { titleEn: 'Edited mid-send' },
        sections: [
          {
            titleEn: 'Civil',
            lines: [
              { descriptionEn: 'Wall', qty: '2', unit: 'lump_sum', unitCost: '600', unitPrice: '1000', discountPct: '0', sortOrder: 0 },
              { descriptionEn: 'Slab', qty: '1', unit: 'lump_sum', unitCost: '100', unitPrice: '300', discountPct: '0', sortOrder: 1 },
            ],
          },
        ],
      }),
      sendProposalCore(ctx, { id }),
    ]);

    const [row] = await raw.query<{ status: string; total: string; title_en: string | null }>(
      `select status, total, title_en from public.proposals where id = '${id}'`,
    );
    const lines = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.proposal_lines where proposal_id = '${id}'`,
    );
    // ATOMICITY: the stored total must match the stored line set, whichever won.
    if (save.ok) {
      expect(lines[0].n).toBe(2);
      expect(Number(row.total)).toBe(2300);
      expect(row.title_en).toBe('Edited mid-send');
    } else {
      expect(lines[0].n).toBe(1);
      expect(Number(row.total)).toBe(1000);
      // OBSERVABILITY: which refusal the loser gets depends on where the send's
      // COMMIT lands relative to the save's own statements, and both answers are
      // correct. If the save's line writes run first, `enforce_proposal_child_draft`
      // still reads 'draft' (a plain SELECT does not block on an uncommitted
      // row lock) and the save is then refused by its own gated header UPDATE,
      // which is `proposal_not_draft` — the gate this loop added. If the send
      // commits before those writes, the MT100 trigger fires instead and
      // `mutationFailureCode` does not classify MT100, so it is `generic`.
      // What must never happen is `ok` on a frozen document, or a silent
      // half-write; the assertions above are the ones that matter.
      expect(['proposal_not_draft', 'generic', 'uncertain']).toContain(save.error);
    }
    expect(send.ok).toBe(true);
    expect(row.status).toBe('sent');
  });

  it('the draft-save header write is GATED on status, deterministically', async () => {
    // The race above cannot pin WHICH refusal the loser gets, so the gate itself
    // is pinned directly: the persist phase runs against a proposal that has
    // already left draft. Its UPDATE matches zero rows and it fails coded, which
    // is what stops a send-racing save reporting success on a frozen document.
    const { ctx, clientId, projectId } = await setup();
    const { id } = await sentProposal(ctx, clientId, projectId);
    const [before] = await raw.query<{ status: string; title_en: string | null }>(
      `select status, title_en from public.proposals where id = '${id}'`,
    );
    expect(before.status).toBe('sent');

    await expect(
      withOrgContext(
        ctx,
        (tx) =>
          persistDraftHeaderAndTotals(
            tx,
            id,
            { titleEn: 'Edited after send' } as never,
            { total: '1.0000' } as never,
          ),
        { write: true },
      ),
    ).rejects.toMatchObject({ code: 'proposal_not_draft' });

    const [after] = await raw.query<{ title_en: string | null }>(
      `select title_en from public.proposals where id = '${id}'`,
    );
    expect(after.title_en).toBe(before.title_en);
  });
});

// R-D  contracts: one contract per proposal, one termination cascade.
describe('R-D contract transitions under concurrency', () => {
  it('two concurrent generates from one accepted proposal write ONE contract', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { id, token } = await sentProposal(ctx, clientId, projectId);
    await respondToProposalByToken(token, { decision: 'accept' });

    const [a, b] = await Promise.all([
      generateContractCore(ctx, { proposalId: id }),
      generateContractCore(ctx, { proposalId: id }),
    ]);
    expect(okCount([a, b])).toBe(1);
    const rows = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.contracts where source_proposal_id = '${id}'`,
    );
    expect(rows[0].n).toBe(1);
    // The unique index is the race guard; the loser should still be told why.
    // Today it can answer `generic` (a 23505 mutateInOrg does not classify).
    expect(['contract_exists', 'generic']).toContain((a.ok ? b : a).error);
  });

  it('two concurrent terminations reject the open VO exactly once', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, {
      contractId,
      titleEn: 'Open VO',
    })) as { data?: string }).data!;

    const [a, b] = await Promise.all([
      terminateContractCore(ctx, { id: contractId }),
      terminateContractCore(ctx, { id: contractId }),
    ]);
    expect(okCount([a, b])).toBe(1);
    expect((a.ok ? b : a).error).toBe('contract_not_signable');

    const termEvents = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.contract_events where contract_id = '${contractId}' and kind = 'terminated'`,
    );
    expect(termEvents[0].n).toBe(1);
    const [vo] = await raw.query<{ status: string }>(
      `select status from public.variation_orders where id = '${voId}'`,
    );
    expect(vo.status).toBe('rejected');
    const audits = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log where entity = 'variation_order' and entity_id = '${voId}' and after->>'status' = 'rejected'`,
    );
    expect(audits[0].n).toBe(1);
  });
});

// R-E  scale: the chunked line insert at the documented cap.
describe('R-E line volume at the MAX_TOTAL_LINES cap', () => {
  it('a 2000-line draft save persists 2000 lines inside the 20s statement timeout', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as {
      data?: string;
    }).data!;
    // 20 sections x 100 lines = 2000, exactly MAX_TOTAL_LINES.
    const sections: SaveDraftInput['sections'] = Array.from({ length: 20 }, (_, s) => ({
      titleEn: `S${s}`,
      sortOrder: s,
      lines: Array.from({ length: 100 }, (_, i) => ({
        descriptionEn: `L${s}-${i}`,
        qty: '2',
        unit: 'sqm' as const,
        unitCost: '10.5',
        unitPrice: '21.25',
        discountPct: '5',
        sortOrder: i,
      })),
    }));

    const started = Date.now();
    const res = await saveProposalDraftCore(ctx, { id, sections });
    const elapsed = Date.now() - started;
    expect(res.ok).toBe(true);
    const lines = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.proposal_lines where proposal_id = '${id}'`,
    );
    expect(lines[0].n).toBe(2000);
    // Budget: 4 statements of 500 rows (~7.5k bind parameters each). If this
    // approaches the 20s statement_timeout, the chunk size or the transaction
    // shape has changed.
    console.log(`2000-line draft save: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(15000);

    // A re-save that sends NO sections must EMPTY the document (deviation D7.1).
    const emptied = await saveProposalDraftCore(ctx, { id, sections: [] });
    expect(emptied.ok).toBe(true);
    const after = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.proposal_lines where proposal_id = '${id}'`,
    );
    expect(after[0].n).toBe(0);
  }, 120000);

  it('the cap refuses 2001 lines BEFORE opening a transaction', async () => {
    const { ctx, clientId, projectId } = await setup();
    const { contractId } = await issuedContract(ctx, clientId, projectId);
    const voId = ((await createVariationDraftCore(ctx, {
      contractId,
      titleEn: 'Oversized',
    })) as { data?: string }).data!;
    const res = await saveVariationDraftCore(ctx, {
      id: voId,
      lines: Array.from({ length: 2001 }, (_, i) => ({
        descriptionEn: `L${i}`,
        qty: '1',
        unit: 'pcs' as const,
        unitCost: '1',
        unitPrice: '2',
        discountPct: '0',
      })),
    });
    expect(res).toEqual({ ok: false, error: 'too_many_lines' });
    const after = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.variation_order_lines where variation_order_id = '${voId}'`,
    );
    expect(after[0].n).toBe(0);
  }, 120000);
});
