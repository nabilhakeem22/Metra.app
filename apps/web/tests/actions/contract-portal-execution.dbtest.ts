import { createTranslator } from 'next-intl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationBody, notificationHref } from '@/components/notifications/feed-item';
import { todayInCairo } from '@/lib/automation/clock';
import { cairoYear } from '@/lib/format/doc-number';
import { loadNotificationFeed } from '@/lib/notifications/feed';
import en from '@/messages/en.json';
import ar from '@/messages/ar-EG.json';
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
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// Stage 2, the client side: the replaced /c and /v SQL
// (rls/functions/30-contracts-variations.sql). DB step A added the keys; DB
// step B caps the snapshot to the page's opening (the first 50 sections, the
// first 50 lines of the whole contract between them, lead rulings Oct 19 and
// Oct 20 D5); the lines and sections readers page the rest; the digest binds
// the acknowledgement to every line and every section; and the two client acts
// tell the studio in the same transaction.

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

  it('carries each section line_count and, between them, only the first 50 lines of the contract (DB step B)', () => {
    const sections = snapshot.sections as Section[];
    expect(sections.map((section) => section.line_count)).toEqual([350, 250]);
    expect(snapshot.section_count).toBe(2);
    expect(sections[0].lines.map((line) => line.id)).toEqual(contract.lineIds[0].slice(0, 50));
    expect(sections[1].lines).toEqual([]);
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

  it('reads through the app reader as the page opens it', async () => {
    const read = await getContractByToken(contract.rawToken!);
    expect(read?.id).toBe(contract.contractId);
    expect(read?.section_count).toBe(2);
    expect(read?.sections.map((section) => section.lines.length)).toEqual([50, 0]);
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

describe('DB step B (Nov 18): the snapshot cap (AC11, lead ruling D5)', () => {
  type CappedSection = { id: string; line_count: number; lines: Array<{ id: string }> };
  let wide: ExecutionContract;

  beforeAll(async () => {
    wide = await seedExecutionContract(orgId, { linesPerSection: Array.from({ length: 120 }, () => 1), state: 'issued' });
  });

  async function sectionsPage(rawToken: string | null, offset: number | null) {
    const [row] = await ownerQuery<{ data: Record<string, unknown> | null }>(
      `select public.app_contract_sections_by_token($1, $2) as data`,
      [rawToken === null ? null : hashShareToken(rawToken), offset],
    );
    return row.data as null | { offset: number; section_count: number; sections: CappedSection[] };
  }

  it('carries the first 50 lines of the WHOLE contract in document order, not 50 per section', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [10, 30, 30], state: 'issued' });
    const sections = (await snapshotOf(contract.rawToken!)).sections as CappedSection[];
    expect(sections.map((section) => [section.lines.length, section.line_count])).toEqual([
      [10, 10],
      [30, 30],
      [10, 30],
    ]);
    expect(sections.flatMap((section) => section.lines.map((line) => line.id))).toEqual(
      [...contract.lineIds[0], ...contract.lineIds[1], ...contract.lineIds[2].slice(0, 10)],
    );
  });

  it('carries the first 50 sections and counts every one', async () => {
    const snapshot = await snapshotOf(wide.rawToken!);
    const sections = snapshot.sections as CappedSection[];
    expect(snapshot.section_count).toBe(120);
    expect(sections.map((section) => section.id)).toEqual(wide.sectionIds.slice(0, 50));
    expect(sections.reduce((sum, section) => sum + section.lines.length, 0)).toBe(50);
  });

  it('app_contract_sections_by_token pages the rest 50 at a time, collapsed, with each line_count', async () => {
    const second = await sectionsPage(wide.rawToken, 50);
    expect(second).toMatchObject({ offset: 50, section_count: 120 });
    expect(second!.sections.map((section) => section.id)).toEqual(wide.sectionIds.slice(50, 100));
    expect(second!.sections.every((section) => section.lines.length === 0 && section.line_count === 1)).toBe(true);
    expect((await sectionsPage(wide.rawToken, 100))!.sections.map((section) => section.id)).toEqual(wide.sectionIds.slice(100));
    expect((await sectionsPage(wide.rawToken, -5))!.offset).toBe(0);
    expect((await sectionsPage(wide.rawToken, null))!.offset).toBe(0);
    expect((await sectionsPage(wide.rawToken, 5_000_000))!).toMatchObject({ offset: 100000, sections: [] });
  });

  it('app_contract_sections_by_token answers null for a bad token and a draft, and names no cost key', async () => {
    const draft = await seedExecutionContract(orgId, { linesPerSection: [1], state: 'draft' });
    const draftToken = mintShareToken();
    await ownerQuery(`update public.contracts set token_hash = $2 where id = $1`, [draft.contractId, draftToken.hash]);
    expect(await sectionsPage(draftToken.raw, 0)).toBeNull();
    expect(await sectionsPage('not-a-token', 0)).toBeNull();
    expect(await sectionsPage(null, 0)).toBeNull();
    const [source] = await ownerQuery<{ prosrc: string }>(
      `select prosrc from pg_proc where proname = 'app_contract_sections_by_token'`,
    );
    expect(source.prosrc).not.toMatch(/unit_cost|line_cost|margin|supervision/);
    for (const key of COST_KEYS) expect(keysOf(await sectionsPage(wide.rawToken, 0)).has(key), key).toBe(false);
  });

  it('the digest, and so the acknowledgement hash, covers a section past the first 50', async () => {
    const before = await getContractByToken(wide.rawToken!);
    await tamper(`update public.contract_sections set title_en = 'Renamed' where id = $1`, [wide.sectionIds[99]]);
    const after = await getContractByToken(wide.rawToken!);
    expect(after!.lines_digest).not.toBe(before!.lines_digest);
    expect(contractPayloadHash(after!)).not.toBe(contractPayloadHash(before!));
  });
});

describe('app_contract_section_lines_by_token: the rest, 100 at a time (AC11)', () => {
  let contract: ExecutionContract;
  let sibling: ExecutionContract;

  beforeAll(async () => {
    contract = await seedExecutionContract(orgId, { linesPerSection: [350, 5], state: 'signed' });
    sibling = await seedExecutionContract(orgId, { linesPerSection: [3], state: 'issued' });
  });

  it('pages a section in (sort_order, id) order, from any offset (offset 50 continues a capped snapshot)', async () => {
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

    // Line 100: beyond the 50 the step-B snapshot will carry, so after the cap
    // only the digest sees it. The digest is asserted on its own for that day.
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

  it('moves lines_digest when a line moves to another section, even with the flat order unchanged (F2)', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [3, 3], state: 'issued' });
    const before = (await snapshotOf(contract.rawToken!)).lines_digest;
    // The last line of section 1 becomes the first line of section 2: the
    // flattened (section, line) order is the same, only the section differs.
    await tamper(`update public.contract_lines set section_id = $2, sort_order = 0 where id = $1`, [
      contract.lineIds[0][2],
      contract.sectionIds[1],
    ]);
    expect((await snapshotOf(contract.rawToken!)).lines_digest).not.toBe(before);
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

describe('app_contract_by_token says when and how the contract was signed (A3 fix round F3, F4)', () => {
  it('null until signed; online is the Cairo day of the acknowledgement', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [2], state: 'issued' });
    expect((await snapshotOf(contract.rawToken!)).signed).toBeNull();
    expect(await acknowledgeContractByToken(contract.rawToken!, { actorName: 'Client' })).toEqual({ ok: true });
    expect((await snapshotOf(contract.rawToken!)).signed).toEqual({ on: todayInCairo(new Date()), via: 'online' });
  });

  it('paper is the day the studio recorded, in Cairo, never the UTC day before it', async () => {
    const contract = await seedExecutionContract(orgId, { linesPerSection: [2], state: 'issued' });
    // What the paper-signature core writes: Cairo midnight of the day, which is
    // 21:00 or 22:00 UTC of the PREVIOUS day.
    await ownerQuery(
      `insert into public.contract_events (org_id, contract_id, kind, actor_user_id, from_status, to_status, decided_at)
       values ($1, $2, 'acknowledged_offline', $3, 'issued', 'signed', ('2026-10-15'::date)::timestamp at time zone 'Africa/Cairo')`,
      [orgId, contract.contractId, members.pm],
    );
    await ownerQuery(`update public.contracts set status = 'signed' where id = $1`, [contract.contractId]);
    expect((await snapshotOf(contract.rawToken!)).signed).toEqual({ on: '2026-10-15', via: 'paper' });
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

  it("DB step B adds the contract's end date and its approved extension days, this order once approved (B5 D1)", async () => {
    const own = await seedExecutionContract(orgId, { linesPerSection: [1], state: 'signed' });
    await seedVariation(orgId, own, 'approved', { timeExtensionDays: 15 });
    await seedVariation(orgId, own, 'rejected', { timeExtensionDays: 90 });
    const open = mintShareToken();
    await seedVariation(orgId, own, 'issued', { timeExtensionDays: 7, tokenHash: open.hash });
    const approved = mintShareToken();
    await seedVariation(orgId, own, 'approved', { timeExtensionDays: 10, tokenHash: approved.hash });
    const documentOf = async (hash: string) =>
      (await ownerQuery<{ data: Record<string, unknown> }>(`select public.app_variation_by_token($1) as data`, [hash]))[0].data;
    expect(await documentOf(open.hash)).toMatchObject({ contract_end_date: '2026-12-31', time_extension_days_total: 25 });
    expect(await documentOf(approved.hash)).toMatchObject({ contract_end_date: '2026-12-31', time_extension_days_total: 25 });
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

describe('the studio feed renders a /c signature and a /v decision on a PROPOSAL contract', () => {
  it('names C- and VO- numbers in both locales and opens the contract', async () => {
    const { clientId, projectId } = await seedClientProject(orgId);
    const [proposal] = await ownerQuery<{ id: string }>(
      `insert into public.proposals (org_id, number, title_en, client_id, project_id, status)
       values ($1, 600000 + floor(random() * 99999)::int, 'Quote', $2, $3, 'accepted') returning id`,
      [orgId, clientId, projectId],
    );
    const token = mintShareToken();
    const [created] = await ownerQuery<{ id: string; number: number }>(
      `insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id,
                                     status, token_hash, share_expires_at)
       values ($1, 500000 + floor(random() * 99999)::int, 'Quote contract', $2, $3, $4, 'draft', $5,
               now() + interval '30 days') returning id, number`,
      [orgId, proposal.id, clientId, projectId, token.hash],
    );
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [created.id]);
    expect(await acknowledgeContractByToken(token.raw, { actorName: 'Client' })).toEqual({ ok: true });
    const voToken = mintShareToken();
    const variation = await seedVariation(orgId, { contractId: created.id, projectId }, 'issued', {
      tokenHash: voToken.hash,
    });
    expect(await respondToVariationByToken(voToken.raw, { decision: 'approve', actorName: 'Client' })).toEqual({
      ok: true,
    });

    const feed = await loadNotificationFeed(ctxFor(orgId, members.pm, 'project_manager'), 50);
    const mine = feed.items.filter((item) => item.entityId === created.id);
    expect(mine.map((item) => item.bodyKey).sort()).toEqual(['client_contract_signed', 'client_variation_approved']);
    const year = cairoYear(new Date());
    for (const [locale, messages] of [['en', en], ['ar-EG', ar]] as const) {
      const translate = createTranslator({ locale, messages, namespace: 'notifications.body' }) as unknown as (
        key: string,
        values?: Record<string, string | number>,
      ) => string;
      const bodies = mine.map((item) => notificationBody(item, translate, (iso) => iso, locale, () => null));
      for (const body of bodies) expect(body.length, `${locale} empty bell line`).toBeGreaterThan(0);
      expect(bodies.join(' ')).toContain(`C-${String(year)}-${String(created.number).padStart(4, '0')}`);
      expect(bodies.join(' ')).toContain(`VO-${String(year)}-${String(variation.number).padStart(4, '0')}`);
    }
    for (const item of mine) expect(notificationHref(item)).toBe(`/contracts/${created.id}`);
  });
});
