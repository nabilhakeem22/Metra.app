import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_ID, homePayload } from '@/test/client-home-payloads';
import type { ClientExecutionReason } from '@/lib/flow/locate/execution-client';

// The client home's reads per view (H4.2, AC16; the Workers CPU budget):
// every token SDF the page makes goes through lib/share/sdf-call, so the calls
// are counted at the one connection they share. The design snapshot and the
// home answer canned payloads; only which functions are called, and how often,
// is asserted. The one state that reads a second call is a contract
// awaiting the client's signature: its document is shown open with the page
// (H6.2, A2; AC1). So does a home with change orders open: their list is read
// with the page, whatever the hero's reason (H7.1, A2; AC1).

const db = vi.hoisted(() => ({
  calls: [] as string[],
  answers: {} as Record<string, unknown>,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  withRequestDb: async (run: (handle: { execute: (query: unknown) => unknown }) => unknown) =>
    run({
      execute: (query: unknown) => {
        const name = /public\.(app_[a-z_]+)\(/.exec(JSON.stringify(query))?.[1] ?? 'unknown';
        db.calls.push(name);
        return [{ data: db.answers[name] ?? null }];
      },
    }),
}));

const { readHomeView } = await import('./home-read');

/** A design snapshot app_delivery_by_token could answer, in the state given. */
function designSnapshot(state: string, entryPhase = 'design'): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    number: 12,
    state,
    entry_phase: entryPhase,
    off_plan: false,
    title_ar: 'فيلا',
    title_en: 'Villa',
    created_at: '2026-06-01T08:00:00Z',
    design_fee_total: null,
    rom: null,
    share_expires_at: null,
    firm: { name_ar: 'نون', name_en: 'Noon', logo_file_id: null },
    client: { name_ar: 'هشام', name_en: 'Hesham' },
    payment_schedule: [],
    client_actions: [],
  };
}

/** The contract snapshot app_home_contract_by_token answers: /c's JSON of the home's contract. */
const CONTRACT_SNAPSHOT = { id: CONTRACT_ID, status: 'issued', source: 'boq', section_count: 0, sections: [], payment_schedule: [] };

function answer(design: string | null, home: Record<string, unknown> | null) {
  db.answers = {
    app_delivery_by_token: design === null ? null : designSnapshot(design),
    app_home_by_token: home,
    app_home_contract_by_token: CONTRACT_SNAPSHOT,
  };
}

/** A LIGHT delivery (entry_phase 'execution'): born at execution, with no design behind it. */
function answerLight(home: Record<string, unknown>) {
  db.answers = {
    app_home_contract_by_token: CONTRACT_SNAPSHOT,
    app_delivery_by_token: designSnapshot('execution', 'execution'),
    app_home_by_token: { ...home, delivery: { ...(home.delivery as object), entry_phase: 'execution' } },
  };
}

const designPhaseHome = () => {
  const home = homePayload('works_in_progress');
  return { ...home, delivery: { ...(home.delivery as object), phase: 'design' }, execution: null };
};

afterEach(() => {
  db.calls = [];
  db.answers = {};
});

type Facts = { execution: { flow_source: { contract: Record<string, unknown> } } };

/** A home whose facts count `open` change orders the client can decide and `lapsed` ones they cannot. */
function withChangeOrders(reason: ClientExecutionReason, open: number, lapsed = 0): Record<string, unknown> {
  const home = homePayload(reason) as unknown as Facts;
  const { contract } = home.execution.flow_source;
  const money = (homePayload('works_in_progress') as unknown as Facts).execution.flow_source.contract.money as object;
  const counts = { open_variations: open + lapsed, issued_variations: open, expired_variations: lapsed };
  return { ...home, execution: { ...home.execution, flow_source: { ...home.execution.flow_source, contract: { ...contract, money: { ...money, ...counts } } } } };
}

const ORDER_DOCUMENT = { id: 'v-1', number: 3, net_delta: '10000.0000', lines: [{ id: 'l-1', description_en: 'SEEDED LINE' }] };

describe('the change orders read with the page (H7.1, AC1)', () => {
  it('decide_change_order: the home, then the open list; the view holds the summary and no line', async () => {
    answer('execution', homePayload('decide_change_order'));
    db.answers.app_home_variations_by_token = { open: [ORDER_DOCUMENT], expired: [], decided: [] };
    const view = await readHomeView('tok', 'execution');
    expect(db.calls).toEqual(['app_home_by_token', 'app_home_variations_by_token']);
    expect(view).toMatchObject({ tab: 'execution', changeOrders: [{ id: 'v-1', number: 3, lineCount: 1 }] });
    expect(JSON.stringify(view)).not.toContain('SEEDED LINE');
  });

  it('awaiting a signature, an order issued on the contract: the home counts a signed contract only, so no list is read', async () => {
    answer('execution', withChangeOrders('sign_contract', 1));
    await readHomeView('tok', 'execution');
    expect(db.calls).toEqual(['app_home_by_token', 'app_home_contract_by_token']);
  });

  it.each<ClientExecutionReason>(['works_in_progress', 'pay_request', 'terminated'])('%s with none open: the home alone, changeOrders null', async (reason) => {
    answer('execution', homePayload(reason));
    const view = await readHomeView('tok', 'execution');
    expect(db.calls).toEqual(['app_home_by_token']);
    expect(view).toMatchObject({ tab: 'execution', changeOrders: null });
  });

  it('only a lapsed order: the home alone', async () => {
    answer('execution', withChangeOrders('works_in_progress', 0, 1));
    await readHomeView('tok', 'execution');
    expect(db.calls).toEqual(['app_home_by_token']);
  });

  it('no tab, at execution: the same set after the design snapshot', async () => {
    answer('execution', homePayload('decide_change_order'));
    db.answers.app_home_variations_by_token = { open: [ORDER_DOCUMENT], expired: [], decided: [] };
    await readHomeView('tok', null);
    expect(db.calls).toEqual(['app_delivery_by_token', 'app_home_by_token', 'app_home_variations_by_token']);
  });
});

describe('reads per view', () => {
  it('the Execution tab: exactly ONE call, app_home_by_token, and never the design snapshot', async () => {
    answer('execution', homePayload('pay_request'));
    const view = await readHomeView('tok', 'execution');
    expect(view.tab).toBe('execution');
    expect(db.calls).toEqual(['app_home_by_token']);
  });

  it('the Execution tab while a contract awaits signature: two calls, the home then the document shown open (H6.2, AC1)', async () => {
    answer('execution', homePayload('sign_contract'));
    const view = await readHomeView('tok', 'execution');
    expect(db.calls).toEqual(['app_home_by_token', 'app_home_contract_by_token']);
    expect(view).toMatchObject({ tab: 'execution', signingDocument: { id: CONTRACT_ID, sections: [] } });
  });

  it.each<ClientExecutionReason>(['signing_closed', 'works_in_progress', 'pay_request', 'terminated'])(
    'the Execution tab at %s: ONE call, no document read with the page (AC1)',
    async (reason) => {
      answer('execution', homePayload(reason));
      const view = await readHomeView('tok', 'execution');
      expect(db.calls).toEqual(['app_home_by_token']);
      expect(view).toMatchObject({ tab: 'execution', signingDocument: null });
    },
  );

  it('awaiting signature, a document that is now another contract is not shown: no document (sign.unavailable)', async () => {
    answer('execution', homePayload('sign_contract'));
    db.answers.app_home_contract_by_token = { ...CONTRACT_SNAPSHOT, id: '00000000-0000-4000-8000-0000000000c2' };
    expect(await readHomeView('tok', 'execution')).toMatchObject({ tab: 'execution', signingDocument: null });
  });

  it('the design tab: exactly ONE call, app_delivery_by_token, in the design phase and as the record at execution', async () => {
    answer('concept_review', null);
    expect((await readHomeView('tok', 'design')).tab).toBe('design');
    answer('execution', homePayload('works_in_progress'));
    expect((await readHomeView('tok', 'design')).tab).toBe('design');
    expect(db.calls).toEqual(['app_delivery_by_token', 'app_delivery_by_token']);
  });

  it('no tab in the design phase: ONE call, the design snapshot, as before', async () => {
    answer('concept_review', null);
    const view = await readHomeView('tok', null);
    expect(view.tab).toBe('design');
    expect(db.calls).toEqual(['app_delivery_by_token']);
  });

  it('no tab at execution: the design snapshot says the phase, then the home opens the Execution tab', async () => {
    answer('execution', homePayload('works_in_progress'));
    const view = await readHomeView('tok', null);
    expect(view.tab).toBe('execution');
    expect(db.calls).toEqual(['app_delivery_by_token', 'app_home_by_token']);
  });

  it('no tab at execution awaiting signature: three calls, the document last (AC1)', async () => {
    answer('execution', homePayload('sign_contract'));
    expect((await readHomeView('tok', null)).tab).toBe('execution');
    expect(db.calls).toEqual(['app_delivery_by_token', 'app_home_by_token', 'app_home_contract_by_token']);
  });

  it('an unknown link asked for the Execution tab: one call, the same not-found as the design tab', async () => {
    answer(null, null);
    expect(await readHomeView('tok', 'execution')).toEqual({ tab: 'design', read: { status: 'not_found' } });
    expect(db.calls).toEqual(['app_home_by_token']);
  });

  it('a light delivery with no tab opens its Execution tab: two calls, as any delivery at execution', async () => {
    answerLight(homePayload('works_in_progress'));
    const view = await readHomeView('tok', null);
    expect(view.tab).toBe('execution');
    expect(db.calls).toEqual(['app_delivery_by_token', 'app_home_by_token']);
  });

  it('a light delivery has no design tab: asked for it, ONE call and the page is sent to the Execution tab (H4 follow-up 1)', async () => {
    answerLight(homePayload('works_in_progress'));
    expect(await readHomeView('tok', 'design')).toEqual({ tab: 'redirect', to: 'execution' });
    expect(db.calls).toEqual(['app_delivery_by_token']);
  });

  it('the Execution tab asked of a delivery still in design opens its design tab', async () => {
    answer('concept_review', designPhaseHome());
    const view = await readHomeView('tok', 'execution');
    expect(view.tab).toBe('design');
    expect(db.calls).toEqual(['app_home_by_token', 'app_delivery_by_token']);
  });
});
