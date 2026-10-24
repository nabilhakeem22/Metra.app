import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import { executionDeliveryStatus } from '@/lib/engagements/delivery-status';
import type { DesignSummary } from '@/lib/engagements/design-summary';
import { executionCardView, type ExecutionCardView } from '@/lib/execution/card-view';
import { NEXT_ACTION_TARGET, STAGES_RECORDING_COSTS } from '@/lib/execution/next-action-target';
import { EXECUTION_NEXT_ACTION_KINDS, EXECUTION_STAGES, type ExecutionNextActionKind, type ExecutionStage } from '@/lib/execution/stage';
import { executionPosition, type ExecutionFlowFacts } from '@/lib/flow/locate/execution-facts';
import { locateExecutionForStudio } from '@/lib/flow/locate/execution-studio';
import { EXECUTION_PHASE } from '@/lib/flow/phases/execution';
import type { Actor } from '@/lib/flow/types';
import { executionModels, flowFactsOf } from '@/test/execution-flow-model';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import type { ExecutionCockpit } from './command-card-props';
import { ExecutionStepCard, type ExecutionStepCardProps } from './execution-step-card';
import { STUDIO_TAKES_BACK } from './execution-step-copy';

// The cockpit at `execution` (client home H2, AC 22 to 25): the design folds
// into one line above the five-step execution rail, and the card names ONE next
// action and offers it as a control the studio can press: a link to the page
// that does it, or the dialog that does it in place (AC10). A role that may not
// take it is told who can, never shown a dead button. The money steps link to
// the contract's Payments tab (A4) or its Final account tab (A5); a role that
// records measurements gets "Record measurements" beside the next action while
// the works are in progress (A5.1).

vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/contracts/actions', () => ({
  generateExecutionContract: vi.fn(),
  recordContractSignedOffline: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => ({ dismissPaymentClaim: vi.fn() }));

// "Record costs" and "Record measurements" sit beside the next action, not in
// its place: the per-action counts below leave them off, and their own tests
// turn them on.
const EVERYTHING = {
  generateContract: true,
  signOffline: true,
  openContract: true,
  recordCosts: false,
  sendRequests: true,
  recordPayments: true,
  recordMeasurements: false,
};
const NOTHING = {
  generateContract: false,
  signOffline: false,
  openContract: false,
  recordCosts: false,
  sendRequests: false,
  recordPayments: false,
  recordMeasurements: false,
};
/** A project manager or a viewer: reads the Payments tab, can take none of its money steps (A4 F6). */
const READS_MONEY_ONLY = { ...EVERYTHING, sendRequests: false, recordPayments: false };
const INSTALMENT = { en: 'Advance', 'ar-EG': 'دفعة مقدمة' } as const;
const NOTHING_OPEN: DesignSummary = { openInstalments: 0, pendingClaims: 0, awaitingReply: 0 };

/** Every fact set a real contract can be in (lib/flow's shared model), with where it locates. */
const FLOWS = [...executionModels(1)].map((m) => {
  const flow = flowFactsOf(m);
  return { flow, result: executionPosition(flow).result, whoseMove: locateExecutionForStudio(flow).whoseMove };
});

/** The first real fact set showing `kind`; the two waits the studio can take back default to the client holding them. */
function flowFor(kind: ExecutionNextActionKind, holder?: Actor): ExecutionFlowFacts {
  const wanted = holder ?? (STUDIO_TAKES_BACK.has(kind) ? 'client' : undefined);
  const found = FLOWS.find(({ result, whoseMove }) => result.next?.kind === kind && (wanted === undefined || whoseMove === wanted));
  if (!found) throw new Error(`no model shows ${kind} held by ${String(wanted)}`);
  return found.flow;
}

function flowAt(stage: ExecutionStage): ExecutionFlowFacts {
  const found = FLOWS.find(({ result }) => result.stage === stage && result.next === null);
  if (!found) throw new Error(`no model ends at ${stage}`);
  return found.flow;
}

/** The card's view of real facts, as the page builds it (lib/execution/card-view.ts). */
function viewOf(flow: ExecutionFlowFacts, may = EVERYTHING): ExecutionCardView {
  const contract = flow.stage.contract;
  return executionCardView(
    {
      flow,
      boqId: 'b-1',
      contract: contract && { id: 'c-1', number: 7, createdAt: '2026-10-01T09:00:00.000Z', status: contract.status },
      nextInstalment: { labelAr: 'دفعة مقدمة', labelEn: 'Advance' },
    },
    { projectId: 'p-1', may },
  );
}

/** The card showing `kind`, or a finished stage when `kind` is null; `stage` overrides the stage for the costs and measurements links. */
function view(kind: ExecutionNextActionKind | null, may = EVERYTHING, stage?: ExecutionStage): ExecutionCardView {
  const base = viewOf(kind ? flowFor(kind) : flowAt(stage ?? 'settled'), may);
  return stage ? { ...base, stage } : base;
}

function cardProps(cockpit: ExecutionCockpit, extra: Partial<ExecutionStepCardProps> = {}): ExecutionStepCardProps {
  return {
    status: executionDeliveryStatus(locateExecutionForStudio(cockpit.view.flow)),
    pending: false,
    paymentClaims: [],
    canResolveClaims: true,
    runAction: vi.fn(),
    actionError: null,
    onOpenTab: vi.fn(),
    ...extra,
  };
}

function renderCard(
  cardView: ExecutionCardView,
  options: { locale?: TestLocale; summary?: DesignSummary; extra?: Partial<ExecutionStepCardProps> } = {},
) {
  const cockpit = { view: cardView, designSummary: options.summary ?? NOTHING_OPEN };
  const props = cardProps(cockpit, options.extra);
  const rendered = renderWithIntl(
    <div dir={options.locale === 'en' ? 'ltr' : 'rtl'}>
      <ExecutionStepCard card={props} execution={cockpit} />
    </div>,
    { locale: options.locale ?? 'ar-EG' },
  );
  // The card's body: the band above it holds the design line's own toggle.
  const body = within(rendered.container.querySelector<HTMLElement>('[data-execution-stage]')!);
  return { ...rendered, props, body };
}

/** The control the dialog opens with: its own button label. */
const DIALOG_BUTTON = {
  generate_contract: 'contracts.execution.generate.open',
  sign_offline: 'contracts.execution.signOffline.open',
} as const;

describe.each<TestLocale>(['en', 'ar-EG'])('the execution step card (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const label = (kind: ExecutionNextActionKind) => at(`execution.card.next.${kind}`).replace('{instalment}', INSTALMENT[locale]);

  test.each([...EXECUTION_NEXT_ACTION_KINDS])('%s: the headline names it and one control takes it', (kind) => {
    const { body } = renderCard(view(kind), { locale });
    expect(body.getByRole('heading', { level: 2 }).textContent).toBe(label(kind));
    const target = NEXT_ACTION_TARGET[kind];
    if (target.kind === 'dialog') {
      expect(body.getAllByRole('button')).toHaveLength(1);
      expect(body.getByRole('button', { name: at(DIALOG_BUTTON[target.dialog]) })).toBeTruthy();
      expect(body.queryAllByRole('link')).toHaveLength(0);
    } else {
      const links = body.getAllByRole('link');
      expect(links).toHaveLength(1);
      expect(links[0].textContent).toBe(label(kind));
      expect(links[0].getAttribute('href')).toMatch(target.page === 'project_boq' ? /\/projects\/p-1\?tab=boq$/ : /\/contracts\/c-1/);
    }
  });

  test('the eyebrow says who acts and on which contract; the hint where the contract stands', () => {
    const { body, unmount } = renderCard(view('send_contract'), { locale });
    expect(body.getByText(`${at('engagements.command.nextAction')} · \u2068C-2026-0007\u2069`)).toBeTruthy();
    expect(body.getByText(at('execution.card.stage.draft'))).toBeTruthy();
    unmount();
    const waiting = renderCard(view('record_signed_offline'), { locale });
    expect(waiting.body.getByText(`${at('engagements.command.pill.waitingClient')} · \u2068C-2026-0007\u2069`)).toBeTruthy();
    expect(waiting.body.getByText(at('execution.card.waitingOnClient'))).toBeTruthy();
  });

  test('the money steps open the Payments tab; the final account steps (A5) the Final account tab', () => {
    for (const kind of ['review_payment_claim', 'send_milestone_request', 'send_variation_request', 'record_payment'] as const) {
      const { body, unmount } = renderCard(view(kind), { locale });
      expect(body.getByRole('link').getAttribute('href')).toMatch(/\/contracts\/c-1\?tab=payments$/);
      unmount();
    }
    for (const kind of ['prepare_final_account', 'review_final_account'] as const) {
      const { body, unmount } = renderCard(view(kind), { locale });
      expect(body.getByRole('link', { name: label(kind) }).getAttribute('href')).toMatch(/\/contracts\/c-1\?tab=final_account$/);
      unmount();
    }
  });

  test('"Record measurements" is offered beside the next action while the works are in progress, to a role that records them', () => {
    const measures = { ...READS_MONEY_ONLY, recordMeasurements: true };
    const { body, unmount } = renderCard(view('record_payment', measures), { locale });
    expect(body.getByRole('link', { name: at('execution.card.recordMeasurements') }).getAttribute('href')).toMatch(/\/contracts\/c-1\/measurements$/);
    unmount();
    for (const [stage, may] of [['in_progress', READS_MONEY_ONLY], ['final_account', measures], ['awaiting_signature', measures]] as const) {
      const { body: other, unmount: close } = renderCard(view('record_payment', may, stage), { locale });
      expect(other.queryByRole('link', { name: at('execution.card.recordMeasurements') }), stage).toBeNull();
      close();
    }
  });

  test('the next payment request names its instalment, or says "the next instalment" when it has no name', () => {
    const { body } = renderCard({ ...view('send_milestone_request'), nextInstalment: null }, { locale });
    const text = at('execution.card.next.send_milestone_request').replace('{instalment}', at('execution.card.anInstalment'));
    expect(body.getByRole('link', { name: text })).toBeTruthy();
  });

  test('a long next-action label wraps across the full width of the card instead of running past it (390 px)', () => {
    const { body } = renderCard(view('send_milestone_request'), { locale });
    const link = body.getByRole('link');
    expect(link.className).toMatch(/(^| )w-full( |$)/);
    expect(link.className).toMatch(/(^| )whitespace-normal( |$)/);
    expect(link.className).not.toMatch(/whitespace-nowrap/);
  });

  test('a role that can only read the money is told the owner, an admin or the accountant does each money step', () => {
    const steps = ['review_payment_claim', 'send_milestone_request', 'send_variation_request', 'record_payment', 'prepare_final_account', 'review_final_account'] as const;
    for (const kind of steps) {
      const { body, unmount } = renderCard(view(kind, READS_MONEY_ONLY), { locale });
      expect(body.queryAllByRole('link'), kind).toHaveLength(0);
      expect(body.queryAllByRole('button'), kind).toHaveLength(0);
      expect(body.getByText(at('execution.card.someoneElseMoney'))).toBeTruthy();
      unmount();
    }
  });

  test('sending a request needs invoices_issue; recording a payment and the claim review need payments create', () => {
    const cases = [
      ['send_milestone_request', { ...READS_MONEY_ONLY, sendRequests: true }, true],
      ['send_milestone_request', { ...READS_MONEY_ONLY, recordPayments: true }, false],
      ['send_variation_request', { ...READS_MONEY_ONLY, sendRequests: true }, true],
      ['record_payment', { ...READS_MONEY_ONLY, recordPayments: true }, true],
      ['record_payment', { ...READS_MONEY_ONLY, sendRequests: true }, false],
      ['review_payment_claim', { ...READS_MONEY_ONLY, recordPayments: true }, true],
      ['review_payment_claim', { ...READS_MONEY_ONLY, sendRequests: true }, false],
    ] as const;
    for (const [kind, may, linked] of cases) {
      const { body, unmount } = renderCard(view(kind, may), { locale });
      expect(body.queryAllByRole('link'), `${kind} ${JSON.stringify(may)}`).toHaveLength(linked ? 1 : 0);
      unmount();
    }
  });

  test('a role that may not take the action is told who can, with no button and no link', () => {
    for (const kind of ['create_contract', 'record_signed_offline', 'send_contract'] as const) {
      const { body, unmount } = renderCard(view(kind, NOTHING), { locale });
      expect(body.queryAllByRole('button')).toHaveLength(0);
      expect(body.queryAllByRole('link')).toHaveLength(0);
      expect(body.getByText(at('execution.card.someoneElse'))).toBeTruthy();
      unmount();
    }
  });

  test('the BOQ link needs no contract permission; settled and terminated say the stage and offer nothing', () => {
    const { body, unmount } = renderCard({ ...view('open_boq', NOTHING), contract: null }, { locale });
    expect(body.getByRole('link', { name: at('execution.card.next.open_boq') })).toBeTruthy();
    unmount();
    for (const stage of ['settled', 'terminated'] as const) {
      const { body: done, unmount: close } = renderCard(view(null, EVERYTHING, stage), { locale });
      expect(done.getByRole('heading', { level: 2 }).textContent).toBe(at(`execution.card.stage.${stage}`));
      expect(done.getByText(`${at('execution.card.title')} · \u2068C-2026-0007\u2069`)).toBeTruthy();
      expect(done.queryAllByRole('button')).toHaveLength(0);
      expect(done.queryAllByRole('link')).toHaveLength(0);
      close();
    }
  });

  test('"Record costs" opens the costs page for a role that records them, from works in progress on (F1)', () => {
    const costs = at('execution.card.recordCosts');
    for (const stage of EXECUTION_STAGES) {
      const { body, unmount } = renderCard(view('record_payment', { ...NOTHING, recordCosts: true }, stage), { locale });
      const link = body.queryByRole('link', { name: costs });
      if (STAGES_RECORDING_COSTS.has(stage)) expect(link?.getAttribute('href')).toMatch(/\/contracts\/c-1\/costs$/);
      else expect(link).toBeNull();
      unmount();
    }
    const { body } = renderCard(view('record_payment', EVERYTHING), { locale });
    expect(body.queryByRole('link', { name: costs })).toBeNull();
  });

  test('the rail draws the five execution steps, the current one with whose move it is (AC22)', () => {
    const { container } = renderCard(view('record_signed_offline'), { locale });
    const steps = [...container.querySelectorAll('[data-rail-step]')];
    expect(steps.map((step) => step.querySelector('[data-rail-label]')?.textContent)).toEqual(
      EXECUTION_PHASE.steps.map((step) => at(`engagements.flow.execution.${step.key}`)),
    );
    expect(container.querySelector('[data-rail-step][aria-current="step"] [data-rail-label]')?.textContent).toBe(
      at('engagements.flow.execution.signature'),
    );
    expect([...container.querySelectorAll('[data-rail-who]')].map((chip) => chip.textContent)).toEqual([
      at('engagements.flow.who.done'),
      at('engagements.flow.who.now.client'),
      at('engagements.flow.who.later.site'),
      at('engagements.flow.who.later.studio'),
      at('engagements.flow.who.later.studio'),
    ]);
  });

  test('a terminated contract mutes the rail and says nobody holds a step', () => {
    const { container } = renderCard(view(null, EVERYTHING, 'terminated'), { locale });
    expect(container.querySelectorAll('[data-rail-step]')).toHaveLength(5);
    expect(container.querySelector('[data-rail-step][aria-current="step"]')).toBeNull();
    expect(container.querySelectorAll('[data-rail-who]')).toHaveLength(0);
  });

  test('a closed signing window is the studio move: the card says so and offers the paper signature', () => {
    const { container, body } = renderCard(viewOf(flowFor('record_signed_offline', 'studio')), { locale });
    expect(body.getByRole('heading', { level: 2 }).textContent).toBe(at('execution.card.studioTakesBack.record_signed_offline.headline'));
    expect(body.getByText(at('execution.card.studioTakesBack.record_signed_offline.hint'))).toBeTruthy();
    expect(body.getByText(`${at('engagements.command.nextAction')} · \u2068C-2026-0007\u2069`)).toBeTruthy();
    expect(body.getByRole('button', { name: at('contracts.execution.signOffline.open') })).toBeTruthy();
    expect(body.queryByText(at('execution.card.waitingOnClient'))).toBeNull();
    expect(container.querySelector('[data-rail-step][aria-current="step"] [data-rail-who]')?.textContent).toBe(at('engagements.flow.who.now.studio'));
  });

  test('a change order approved inside the studio is the studio move: issue it', () => {
    const { body, unmount } = renderCard(viewOf(flowFor('await_variation_answer', 'studio')), { locale });
    const issue = at('execution.card.studioTakesBack.await_variation_answer.headline');
    expect(body.getByRole('heading', { level: 2 }).textContent).toBe(issue);
    expect(body.getByText(at('execution.card.studioTakesBack.await_variation_answer.hint'))).toBeTruthy();
    expect(body.getByRole('link', { name: issue }).getAttribute('href')).toMatch(/\/contracts\/c-1\?tab=variations$/);
    unmount();
    // Issued to the client and waiting on their answer: the client's wait, in the old words.
    const waiting = renderCard(viewOf(flowFor('await_variation_answer', 'client')), { locale });
    expect(waiting.body.getByRole('heading', { level: 2 }).textContent).toBe(at('execution.card.next.await_variation_answer'));
  });
});

describe('the waits the studio can take back', () => {
  test('every next action whose holder depends on the facts has the studio wording in both languages', () => {
    const holders = new Map<ExecutionNextActionKind, Set<Actor | null>>();
    for (const { result, whoseMove } of FLOWS) {
      if (!result.next) continue;
      holders.set(result.next.kind, (holders.get(result.next.kind) ?? new Set<Actor | null>()).add(whoseMove));
    }
    const shifting = [...holders].filter(([, actors]) => actors.size > 1).map(([kind]) => kind);
    expect(new Set(shifting)).toEqual(STUDIO_TAKES_BACK);
    for (const kind of STUDIO_TAKES_BACK) {
      for (const locale of ['en', 'ar-EG'] as const) {
        for (const field of ['headline', 'hint']) expect(messageAt(locale, `execution.card.studioTakesBack.${kind}.${field}`)).toBeTruthy();
      }
    }
  });
});

describe.each<TestLocale>(['en', 'ar-EG'])('the design summary line (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const toggle = () => screen.getByRole('button', { expanded: false });

  test('one instalment open reads "Design: complete · 1 payment open"; nothing open reads "Design: complete" (AC23)', () => {
    const { container, unmount } = renderCard(view('record_payment'), { locale, summary: { ...NOTHING_OPEN, openInstalments: 1 } });
    const line = container.querySelector('[data-design-summary] button')!;
    const once = locale === 'en' ? '1 payment open' : 'دفعة واحدة مفتوحة';
    expect(line.textContent).toBe(`${at('engagements.designSummary.complete')}·${once}${at('engagements.designSummary.show')}`);
    unmount();
    const nothing = renderCard(view('record_payment'), { locale });
    expect(nothing.container.querySelector('[data-design-summary] button')!.textContent).toBe(
      `${at('engagements.designSummary.complete')}${at('engagements.designSummary.show')}`,
    );
  });

  test('the design rail appears only once the line is expanded, with every step done (AC22)', () => {
    const { container } = renderCard(view('record_payment'), { locale, summary: { openInstalments: 1, pendingClaims: 2, awaitingReply: 3 } });
    const designSteps = () => container.querySelectorAll('[data-design-summary] [data-rail-step]');
    expect(designSteps()).toHaveLength(0);
    fireEvent.click(toggle());
    expect(designSteps()).toHaveLength(8);
    expect(container.querySelector('[data-design-summary] [aria-current="step"]')).toBeNull();
    expect(container.querySelectorAll('[data-design-summary] [data-rail-step] svg')).toHaveLength(8);
    expect(screen.getByRole('button', { expanded: true }).textContent).toContain(at('engagements.designSummary.hide'));
    // Latin digits in both locales.
    expect(container.querySelector('[data-design-summary] ul')!.textContent).toMatch(/3/);
    expect(container.textContent).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
  });

  test('the expanded line opens the Files, Payments and Timeline tabs, and not while a write is in flight', () => {
    const { props, unmount } = renderCard(view('record_payment'), { locale });
    fireEvent.click(toggle());
    for (const tab of ['files', 'payments', 'timeline'] as const) {
      fireEvent.click(screen.getByRole('button', { name: at(`engagements.panels.${tab}`) }));
      expect(props.onOpenTab).toHaveBeenLastCalledWith(tab);
    }
    unmount();
    renderCard(view('record_payment'), { locale, extra: { pending: true } });
    fireEvent.click(toggle());
    expect((screen.getByRole('button', { name: at('engagements.panels.files') }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('no em dash and no physical inline direction anywhere in the card', () => {
    const { container } = renderCard(view('record_signed_offline'), { locale, summary: { openInstalments: 1, pendingClaims: 1, awaitingReply: 1 } });
    fireEvent.click(toggle());
    expect(container.textContent).not.toMatch(/[\u2013\u2014]/);
    for (const element of container.querySelectorAll('[class]')) {
      expect(element.getAttribute('class'), element.outerHTML).not.toMatch(/(^|\s|:)(left|right|[mp][lr]-|border-[lr]|rounded-[lr]|text-left|text-right)/);
    }
  });
});

describe('the card at execution', () => {
  test('wears the colour of whose move it is: brand for the studio, neutral while it waits on the client, done once settled', () => {
    const borderOf = (cardView: ExecutionCardView, status: DeliveryStatus) =>
      renderCard(cardView, { extra: { status } }).container.querySelector('section')!.className;
    expect(borderOf(view('send_contract'), { kind: 'yourMove' })).toContain('border-[color:var(--brand-tint-border)]');
    expect(borderOf(view('record_signed_offline'), { kind: 'waitingClient', days: null })).toContain('border-[color:var(--rule)]');
    expect(borderOf(view(null, EVERYTHING, 'settled'), { kind: 'delivered' })).toContain('border-[color:var(--success-tint)]');
  });

  test('a client payment claim left on the finished design can still be dismissed, by a role that resolves claims', () => {
    const claim = { id: 'claim-1', milestoneKind: 'balance' as const, claimedAmount: '36000.0000', note: null, actorName: null, createdAt: new Date('2026-06-01T00:00:00Z') };
    const { body, unmount } = renderCard(view('record_payment'), { extra: { paymentClaims: [claim] } });
    expect(body.getByRole('button', { name: messageAt('ar-EG', 'engagements.paymentClaims.dismiss') })).toBeTruthy();
    unmount();
    const other = renderCard(view('record_payment'), { extra: { paymentClaims: [claim], canResolveClaims: false } });
    expect(other.body.queryByRole('button', { name: messageAt('ar-EG', 'engagements.paymentClaims.dismiss') })).toBeNull();
  });
});
