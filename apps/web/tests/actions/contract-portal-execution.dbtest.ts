import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acknowledgeContractByToken,
  contractPayloadHash,
  getContractByToken,
} from '@/lib/contracts/public';
import { hashShareToken, mintShareToken } from '@/lib/share/token';
import { getVariationByToken, respondToVariationByToken } from '@/lib/variations/public';
import {
  closeExecutionFixture,
  ownerQuery,
  seedClientProject,
  seedExecutionContract,
  seedVariation,
  tamper,
  type ExecutionContract,
} from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Stage 2 DB step A, the client side: the replaced /c and /v SQL
// (rls/functions/30-contracts-variations.sql). The snapshot stays ADDITIVE, so
// the app deployed BEFORE this SQL (lib/contracts/public.ts and
// lib/variations/public.ts, exercised here unchanged) keeps working between
// `db:apply-rls` and the deploy; the new lines reader pages the rest; the
// digest binds the acknowledgement to every line; and the two client acts tell
// the studio in the same transaction.

const orgIds: string[] = [];
let orgId: string;
let members: Record<string, string>;

const COST_KEYS = ['unit_cost', 'line_cost', 'line_margin', 'total_cost', 'total_margin', 'cost_item_id'];

beforeAll(async () => {
  const seeded = await seedOrg({
    owners: 1,
    members: [
      { role: 'admin' },
      { role: 'project_manager' },
      { role: 'site_engineer' },
      { role: 'accountant' },
      { role: 'viewer' },
      { role: 'client' },
    ],
  });
  orgId = seeded.orgId;
  orgIds.push(orgId);
  const [admin, pm, siteEngineer, accountant, viewer, client] = seeded.memberIds;
  members = { owner: seeded.ownerIds[0], admin, pm, siteEngineer, accountant, viewer, client };
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

async function snapshotOf(rawToken: string): Promise<Record<string, unknown>> {
  const [row] = await ownerQuery<{ data: Record<string, unknown> | null }>(
    `select public.app_contract_by_token($1) as data`,
    [hashShareToken(rawToken)],
  );
  return row.data as Record<string, unknown>;
}

async function sectionLines(rawToken: string | null, sectionId: string | null, offset: number | null) {
  const [row] = await ownerQuery<{ data: Record<string, unknown> | null }>(
    `select public.app_contract_section_lines_by_token($1, $2, $3) as data`,
    [rawToken === null ? null : hashShareToken(rawToken), sectionId, offset],
  );
  return row.data as null | { section_id: string; offset: number; line_count: number; lines: Array<Record<string, unknown>> };
}

/** Every object key anywhere in a JSON value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, into);
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}

describe('app_contract_by_token: a 600-line execution contract (AC11, A20)', () => {
  let contract: ExecutionContract;
  let snapshot: Record<string, unknown>;
  type Section = { id: string; line_count: number; lines: Array<{ id: string; sort_order: number; item_code: string; provisional: boolean }> };

  beforeAll(async () => {
    contract = await seedExecutionContract(orgId, {
      linesPerSection: [350, 250],
      state: 'issued',
      schedule: [
        { labelEn: 'Advance', basis: 'percent', value: '50' },
        { labelEn: 'Midway', basis: 'percent', value: '30' },
        { labelEn: 'Handover', basis: 'percent', value: '20' },
      ],
    });
    await seedVariation(orgId, contract, 'approved', { timeExtensionDays: 15 });
    await seedVariation(orgId, contract, 'approved', { timeExtensionDays: 15 });
    await seedVariation(orgId, contract, 'issued', { timeExtensionDays: 40 });
    await seedVariation(orgId, contract, 'rejected', { timeExtensionDays: 90 });
    snapshot = await snapshotOf(contract.rawToken!);
  });

  it('carries at most 50 lines per section, the first 50 by sort order, and every section line_count', () => {
    const sections = snapshot.sections as Section[];
    expect(sections.map((section) => section.line_count)).toEqual([350, 250]);
    for (const [index, section] of sections.entries()) {
      expect(section.lines).toHaveLength(50);
      expect(section.lines.map((line) => line.id)).toEqual(contract.lineIds[index].slice(0, 50));
    }
    expect(sections[0].lines[4]).toMatchObject({ item_code: 'A-5', provisional: true });
    expect(sections[0].lines[3]).toMatchObject({ item_code: 'A-4', provisional: false });
  });

  it('adds source, the schedule, the digest and the approved extension days, and keeps every old key', () => {
    expect(snapshot.source).toBe('boq');
    expect(snapshot.payment_schedule).toEqual([
      { label_ar: null, label_en: 'Advance', basis: 'percent', value: '50.0000', sort_order: 0 },
      { label_ar: null, label_en: 'Midway', basis: 'percent', value: '30.0000', sort_order: 1 },
      { label_ar: null, label_en: 'Handover', basis: 'percent', value: '20.0000', sort_order: 2 },
    ]);
    expect(snapshot.lines_digest).toMatch(/^[0-9a-f]{64}$/);
    // 15 + 15 approved; the issued and the rejected orders add nothing.
    expect(snapshot.time_extension_days_total).toBe(30);
    for (const key of ['id', 'number', 'status', 'original_value', 'total', 'tax_rate', 'supervision_pct', 'org', 'sections']) {
      expect(snapshot, key).toHaveProperty(key);
    }
  });

  it('reads through the app deployed BEFORE this SQL (lib/contracts/public.ts unchanged)', async () => {
    const read = await getContractByToken(contract.rawToken!);
    expect(read?.id).toBe(contract.contractId);
    expect(read?.sections).toHaveLength(2);
    expect(read?.sections[0].lines).toHaveLength(50);
    expect(contractPayloadHash(read!)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('names no cost or margin key anywhere (the cost-blind rule)', () => {
    const keys = keysOf(snapshot);
    for (const key of COST_KEYS) expect(keys.has(key), key).toBe(false);
  });

  it('answers a proposal contract with source proposal, an empty schedule and no extension', async () => {
    const { clientId, projectId } = await seedClientProject(orgId);
    const [proposal] = await ownerQuery<{ id: string }>(
      `insert into public.proposals (org_id, number, title_en, client_id, project_id, status)
       values ($1, 800000 + floor(random() * 99999)::int, 'Quote', $2, $3, 'accepted') returning id`,
      [orgId, clientId, projectId],
    );
    const token = mintShareToken();
    await ownerQuery(
      `insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id,
                                     status, token_hash, share_expires_at)
       values ($1, 700000 + floor(random() * 99999)::int, 'Quote contract', $2, $3, $4, 'draft', $5,
               now() + interval '30 days')`,
      [orgId, proposal.id, clientId, projectId, token.hash],
    );
    await ownerQuery(`update public.contracts set status = 'issued' where token_hash = $1`, [token.hash]);
    const quote = await snapshotOf(token.raw);
    expect(quote).toMatchObject({ source: 'proposal', payment_schedule: [], time_extension_days_total: 0, sections: [] });
    expect(quote.lines_digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('app_contract_section_lines_by_token: the rest, 100 at a time (AC11)', () => {
  let contract: ExecutionContract;
  let sibling: ExecutionContract;

  beforeAll(async () => {
    contract = await seedExecutionContract(orgId, { linesPerSection: [350, 5], state: 'signed' });
    sibling = await seedExecutionContract(orgId, { linesPerSection: [3], state: 'issued' });
  });

  it('pages a section in (sort_order, id) order, continuing where the snapshot stopped', async () => {
    const first = await sectionLines(contract.rawToken, contract.sectionIds[0], 50);
    expect(first).toMatchObject({ section_id: contract.sectionIds[0], offset: 50, line_count: 350 });
    expect(first!.lines.map((line) => line.id)).toEqual(contract.lineIds[0].slice(50, 150));
    const last = await sectionLines(contract.rawToken, contract.sectionIds[0], 300);
    expect(last!.lines.map((line) => line.id)).toEqual(contract.lineIds[0].slice(300));
  });

  it('clamps the offset to 0..100000 (null and negative read from 0)', async () => {
    for (const offset of [null, -5]) {
      const page = await sectionLines(contract.rawToken, contract.sectionIds[1], offset);
      expect(page).toMatchObject({ offset: 0 });
      expect(page!.lines.map((line) => line.id)).toEqual(contract.lineIds[1]);
    }
    const beyond = await sectionLines(contract.rawToken, contract.sectionIds[1], 2_000_000_000);
    expect(beyond).toMatchObject({ offset: 100000, lines: [], line_count: 5 });
  });

  it('answers null, uniformly, for another contract’s section, a bad token, a null section and a draft', async () => {
    expect(await sectionLines(contract.rawToken, sibling.sectionIds[0], 0)).toBeNull();
    expect(await sectionLines(mintShareToken().raw, contract.sectionIds[0], 0)).toBeNull();
    expect(await sectionLines(null, contract.sectionIds[0], 0)).toBeNull();
    expect(await sectionLines(contract.rawToken, null, 0)).toBeNull();
    const draft = await seedExecutionContract(orgId, { linesPerSection: [2], state: 'draft' });
    const token = mintShareToken();
    await ownerQuery(`update public.contracts set token_hash = $2 where id = $1`, [draft.contractId, token.hash]);
    expect(await sectionLines(token.raw, draft.sectionIds[0], 0)).toBeNull();
  });

  it('names no cost key, and its source selects no cost column', async () => {
    const page = await sectionLines(contract.rawToken, contract.sectionIds[0], 0);
    const keys = keysOf(page);
    for (const key of COST_KEYS) expect(keys.has(key), key).toBe(false);
    const [source] = await ownerQuery<{ prosrc: string }>(
      `select prosrc from pg_proc where proname = 'app_contract_section_lines_by_token'`,
    );
    expect(source.prosrc).not.toMatch(/unit_cost|line_cost|margin|supervision/);
  });
});

describe('the acknowledgement covers every line and the schedule (AC12)', () => {
  it('moves lines_digest and the payload hash when a line beyond the first 50, or a schedule row, differs', async () => {
    const contract = await seedExecutionContract(orgId, {
      linesPerSection: [120],
      state: 'issued',
      schedule: [{ labelEn: 'All', basis: 'percent', value: '100' }],
    });
    const before = await getContractByToken(contract.rawToken!);
    const digestBefore = (before as unknown as { lines_digest: string }).lines_digest;

    // Line 100 is not in the snapshot's 50; only the digest can see it.
    await tamper(`update public.contract_lines set unit_price = 101 where id = $1`, [contract.lineIds[0][99]]);
    const afterLine = await getContractByToken(contract.rawToken!);
    const digestAfterLine = (afterLine as unknown as { lines_digest: string }).lines_digest;
    expect(digestAfterLine).not.toBe(digestBefore);
    expect(contractPayloadHash(afterLine!)).not.toBe(contractPayloadHash(before!));

    await tamper(`update public.contract_payment_milestones set label_en = 'Everything' where contract_id = $1`, [
      contract.contractId,
    ]);
    const afterSchedule = await getContractByToken(contract.rawToken!);
    expect((afterSchedule as unknown as { lines_digest: string }).lines_digest).not.toBe(digestAfterLine);

    // Stable when nothing moved.
    const again = await getContractByToken(contract.rawToken!);
    expect(contractPayloadHash(again!)).toBe(contractPayloadHash(afterSchedule!));
  });

  it('notifies each owner, admin and project manager once, and nobody else', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [2], state: 'issued' });
    const result = await acknowledgeContractByToken(contract.rawToken!, { actorName: 'Client' });
    expect(result).toEqual({ ok: true });

    const rows = await ownerQuery<{
      recipient_user_id: string;
      kind: string;
      entity_type: string;
      entity_id: string;
      body_key: string;
      params: { number: number; year: number };
    }>(
      `select recipient_user_id, kind, entity_type, entity_id, body_key, params
         from public.notifications where org_id = $1 and entity_id = $2`,
      [orgId, contract.contractId],
    );
    expect(rows.map((row) => row.recipient_user_id).sort()).toEqual(
      [members.owner, members.admin, members.pm].sort(),
    );
    const [year] = await ownerQuery<{ y: number }>(
      `select extract(year from created_at at time zone 'Africa/Cairo')::int as y from public.contracts where id = $1`,
      [contract.contractId],
    );
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: 'client_responded',
        entity_type: 'contract',
        body_key: 'client_contract_signed',
        params: { number: contract.contractNumber, year: year.y },
      });
    }

    // A repeat answers already and writes nothing more.
    expect(await acknowledgeContractByToken(contract.rawToken!, { actorName: 'Client' })).toMatchObject({ ok: false });
    const [count] = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from public.notifications where org_id = $1 and entity_id = $2`,
      [orgId, contract.contractId],
    );
    expect(count.n).toBe(3);
  });
});

describe('/v: the charge breakdown keys and the decision notifications (D4a, AC19 DB part)', () => {
  let contract: ExecutionContract;

  beforeAll(async () => {
    contract = await seedExecutionContract(orgId, { linesPerSection: [1], state: 'signed' });
  });

  it('adds tax_rate, supervision_pct, time_extension_days and contract_source', async () => {
    const token = mintShareToken();
    await seedVariation(orgId, contract, 'issued', { timeExtensionDays: 12, tokenHash: token.hash });
    const read = (await getVariationByToken(token.raw)) as unknown as Record<string, unknown>;
    expect(read).toMatchObject({
      tax_rate: '14.0000',
      supervision_pct: '10.0000',
      time_extension_days: 12,
      contract_source: 'boq',
      contractActive: true,
    });
    expect(keysOf(read).has('line_cost')).toBe(false);
  });

  for (const [decision, bodyKey] of [
    ['approve', 'client_variation_approved'],
    ['reject', 'client_variation_rejected'],
  ] as const) {
    it(`${decision}: notifies owner, admin and project manager with the change order's number`, async () => {
      const token = mintShareToken();
      const variation = await seedVariation(orgId, contract, 'issued', { tokenHash: token.hash });
      expect(await respondToVariationByToken(token.raw, { decision, actorName: 'Client' })).toEqual({ ok: true });
      const rows = await ownerQuery<{ recipient_user_id: string; body_key: string; entity_type: string; params: { number: number } }>(
        `select recipient_user_id, body_key, entity_type, params from public.notifications
          where org_id = $1 and entity_id = $2 and params ->> 'number' = $3`,
        [orgId, contract.contractId, String(variation.number)],
      );
      expect(rows.map((row) => row.recipient_user_id).sort()).toEqual(
        [members.owner, members.admin, members.pm].sort(),
      );
      for (const row of rows) expect(row).toMatchObject({ body_key: bodyKey, entity_type: 'contract' });

      expect(await respondToVariationByToken(token.raw, { decision, actorName: 'Client' })).toMatchObject({ ok: false });
      const [count] = await ownerQuery<{ n: number }>(
        `select count(*)::int as n from public.notifications
          where org_id = $1 and body_key = $2 and params ->> 'number' = $3`,
        [orgId, bodyKey, String(variation.number)],
      );
      expect(count.n).toBe(3);
    });
  }
});
