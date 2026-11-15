// CHARACTERIZATION of commandCardPropsOf: the command card's 31 props, their
// order, which of them are the SAME object the page loaded (handed on, never
// copied), and the error for a bad input. Written against the function as it
// stood BEFORE the review-round start and the execution cockpit were named, and
// not edited since: a refactor that changes a prop's value, the key order,
// hands on a copy, derives a prop from another field, or throws something else
// fails here.
//
// Two layers; the outputs are short, so the whole outputs are inline literals.
// Named scenarios compare two whole results and each derived prop against
// literals. A generated grid (one factor at a time, every state and every
// entry phase with what they select, the concept and trigger pairs, 300 seeded
// random cases, and every named input) is compared by digest
// (command-card-props-of.golden-digests.json). Every digest is the unsplit
// function's own output.
//
// No module is doubled: the review-round rule, the concept options, the
// secondary triggers and the design summary run for real. share-anchor.ts is
// imported for the identity of openDeliveryReminder; it is never called.
import { describe, expect, it } from 'vitest';
import { baseOf, digestOf, oneFactorAtATime, randomCases, type ChoiceOf } from '@/test/golden-cases';
import { ABSENT } from '@/test/priced-document-cases';
import { createRecordingTx } from '@/test/recording-tx';
import { commandCardPropsOf } from './command-card-props-of';
import recorded from './command-card-props-of.golden-digests.json';
import { openDeliveryReminder } from './share-anchor';

// It keeps key order, prints `undefined`, and tells 3 from "3".
const { render } = createRecordingTx();

type Detail = Parameters<typeof commandCardPropsOf>[0];
type Action = Parameters<typeof commandCardPropsOf>[1];
type OpenTab = Parameters<typeof commandCardPropsOf>[2];

// ------------------------------------------------------------------- fixtures

const tr = (toState: string | null, decidedAt: Date | string | null | undefined, id = 't') => ({
  id,
  trigger: 'x',
  fromState: 'layout',
  toState,
  actorUserId: 'u',
  note: null,
  idempotencyKey: null,
  decidedAt,
});
const art = (id: string, kind: string, conceptPosition: number | null) => ({ id, kind, conceptPosition, title: 'a ' + id });
const pay = (kind: string, amount: string) => ({
  id: 'pay-' + kind,
  kind,
  amount,
  method: null,
  reference: null,
  clearedAt: new Date('2026-10-02T00:00:00.000Z'),
  note: null,
  idempotencyKey: null,
});
const D = (iso: string) => new Date(iso);

// Four distinct functions that do nothing: which one comes back is what is pinned.
const runA = () => undefined;
const runB = () => undefined;
const tabA = () => undefined;
const tabB = () => undefined;

// The FIRST value of each pool is the base.
const POOLS = {
  id: ['e-1', 'e-2'],
  projectId: ['p-1', 'p-2'],
  state: ['execution', 'created', 'concept_review', 'final_approval', 'survey', 'execution_decision', 'closed_design_only'],
  entryPhase: ['design', 'execution', 'other'],
  revisionCount: [0, 3],
  freeRevisionN: [2, 5],
  designRevisionCount: [0, 4],
  freeDesignRevisionN: [1, 6],
  offPlan: [false, true],
  clientHasEmail: [true, false],
  rendersReadyAt: [null, '2026-10-05T08:00:00.000Z', '2026-11-01T12:30:00.000Z', undefined, ''],
  createdAt: ['2026-10-01T09:00:00.000Z', '2026-09-15T07:45:00.000Z', 'not a date'],
  transitions: [
    [],
    [tr('concept_review', D('2026-10-03T10:00:00.000Z'))],
    [tr('concept_review', D('2026-10-09T10:00:00.000Z'), 'new'), tr('concept_review', D('2026-10-03T10:00:00.000Z'), 'old')],
    [tr('layout', D('2026-10-02T10:00:00.000Z')), tr('concept_review', '2026-10-04T11:00:00.000Z')],
    [tr('layout', D('2026-10-02T10:00:00.000Z'))],
    [tr('concept_review', null)],
    [tr('concept_review', undefined)],
    [tr(null, D('2026-10-02T10:00:00.000Z'))],
    [tr('concept_review', D('nope'))],
  ],
  artifacts: [
    [],
    [art('a1', 'concept_option', 1)],
    [art('a2', 'concept_option', 2), art('a1', 'concept_option', 1), art('r1', 'render', null)],
    [art('a1', 'concept_option', null), art('m', 'moodboard', null)],
    [art('a1', 'concept_option', 1), art('a2', 'concept_option', 2), art('a3', 'concept_option', 3), art('a4', 'concept_option', 4)],
  ],
  clientDecision: [null, { kind: 'concept_approval' }, { kind: 'changes_requested' }],
  primaryTrigger: [null, 'confirmConcept', 'approveDesign'],
  nextActions: [
    [],
    ['confirmConcept'],
    ['confirmConcept', 'requestRevision', 'abandon'],
    ['chooseDesignOnly', 'chooseExecution', 'abandon'],
    ['approveDesign', 'rejectDesign'],
  ],
  recordPayment: [true, false],
  setRom: [true, false],
  canAdvance: [false, true],
  canRecordOfflineApproval: [false, true],
  canResolveClaims: [false, true],
  canShare: [false, true],
  canUpload: [false, true],
  status: ['your_move', 'waiting_on_client'],
  boqStep: [{ current: null }, { current: { documentNumber: 'BQ-2026-0007' } }],
  feeSplitPrefill: [null, { rows: [1] }],
  paymentClaims: [[], [{ id: 'c1' }], [{ id: 'c1' }, { id: 'c2' }]],
  awaitingReplyCount: [0, 1, 4],
  clientActivity: [[], [{ at: 'x' }]],
  clientExpected: [null, { date: '2026-12-01' }],
  execution: [{ stage: 'in_progress' }, { stage: 'contract_sent', flow: { a: 1 } }, null, undefined, ABSENT, false, 0, ''],
  designFee: ['1000.0000', null, '2500.0000'],
  milestones: [
    [{ kind: 'deposit', basis: 'amount', value: '1000.0000' }],
    [],
    [
      { kind: 'deposit', basis: 'amount', value: '400.0000' },
      { kind: 'final', basis: 'percent', value: '50' },
    ],
  ],
  payments: [[], [pay('deposit', '1000.0000')], [pay('deposit', '400.0000')]],
  pending: [false, true],
  runAction: [runA, runB],
  actionError: [null, { code: 'generic', reference: 'r-1' }],
  onOpenTab: [tabA, tabB],
};
type Choice = ChoiceOf<typeof POOLS>;

const BASE = baseOf(POOLS);
/** Every pool's SECOND value: with the base, every handed-on value appears twice. */
const SECOND = Object.fromEntries(Object.entries(POOLS).map(([key, pool]) => [key, pool[1]])) as Choice;

/** What the function is called with. */
interface Input {
  detail: Record<string, unknown>;
  action: unknown;
  onOpenTab: unknown;
}

/** A copy that shares nothing with the pool it came from. */
const fresh = <T>(value: T): T => structuredClone(value);

/** The page's detail, the action state and the tab callback for one choice: every array and object copied fresh. */
function inputOf(choice: Choice): Input {
  const detail: Record<string, unknown> = {
    header: {
      id: choice.id,
      projectId: choice.projectId,
      state: choice.state,
      entryPhase: choice.entryPhase,
      revisionCount: choice.revisionCount,
      freeRevisionN: choice.freeRevisionN,
      designRevisionCount: choice.designRevisionCount,
      freeDesignRevisionN: choice.freeDesignRevisionN,
      offPlan: choice.offPlan,
      rendersReadyAt: choice.rendersReadyAt,
      createdAt: choice.createdAt,
      clientHasEmail: choice.clientHasEmail,
    },
    feeSchedule: { designFee: choice.designFee, milestones: fresh(choice.milestones) },
    capabilities: { recordPayment: choice.recordPayment, setRom: choice.setRom, recordArtifact: true, retract: false },
    gatePreview: { clientDecision: fresh(choice.clientDecision), primaryTrigger: choice.primaryTrigger, items: [] },
    transitions: fresh(choice.transitions),
    artifacts: fresh(choice.artifacts),
    nextActions: fresh(choice.nextActions),
    canAdvance: choice.canAdvance,
    canRecordOfflineApproval: choice.canRecordOfflineApproval,
    canResolveClaims: choice.canResolveClaims,
    canShare: choice.canShare,
    canUpload: choice.canUpload,
    status: choice.status,
    boqStep: fresh(choice.boqStep),
    feeSplitPrefill: fresh(choice.feeSplitPrefill),
    paymentClaims: fresh(choice.paymentClaims),
    awaitingReplyCount: choice.awaitingReplyCount,
    clientActivity: fresh(choice.clientActivity),
    clientExpected: fresh(choice.clientExpected),
    payments: fresh(choice.payments),
  };
  if (choice.execution !== ABSENT) detail.execution = fresh(choice.execution);
  return {
    detail,
    action: { pending: choice.pending, runAction: choice.runAction, actionError: fresh(choice.actionError) },
    onOpenTab: choice.onOpenTab,
  };
}

// ----------------------------------------------------------------- one call

interface Run {
  id: string;
  input: () => Input;
}

type Result = Record<string, unknown>;

interface Observed {
  input: Input;
  /** The returned props; undefined when the call threw. */
  result: Result | undefined;
  thrown: unknown;
}

function observe(run: Run): Observed {
  const input = run.input();
  try {
    const result = commandCardPropsOf(input.detail as unknown as Detail, input.action as Action, input.onOpenTab as OpenTab);
    return { input, result: result as unknown as Result, thrown: null };
  } catch (thrown) {
    return { input, result: undefined, thrown };
  }
}

/** The props of a call that returned. */
function propsOf(run: Run): Result {
  const { result, thrown } = observe(run);
  if (result === undefined) throw thrown;
  return result;
}

/** For each handed-on prop, whether the result holds the SAME reference as the input. */
function referencesOf(result: Result, input: Input): string {
  const { detail } = input;
  const action = input.action as Record<string, unknown>;
  const cockpit = result.execution;
  const view = cockpit !== null && typeof cockpit === 'object' ? (cockpit as Result).view === detail.execution : 'no view';
  return [
    ['boqStep', result.boqStep === detail.boqStep],
    ['preview', result.preview === detail.gatePreview],
    ['feeSplitPrefill', result.feeSplitPrefill === detail.feeSplitPrefill],
    ['paymentClaims', result.paymentClaims === detail.paymentClaims],
    ['clientActivity', result.clientActivity === detail.clientActivity],
    ['clientExpected', result.clientExpected === detail.clientExpected],
    ['actionError', result.actionError === action.actionError],
    ['execution.view', view],
    ['runAction', result.runAction === action.runAction],
    ['onOpenTab', result.onOpenTab === input.onOpenTab],
    ['onNudge', result.onNudge === openDeliveryReminder],
  ]
    .map(([name, same]) => `${name}=${same}`)
    .join(',');
}

const ALL_THE_SAME =
  'boqStep=true,preview=true,feeSplitPrefill=true,paymentClaims=true,clientActivity=true,clientExpected=true,actionError=true,execution.view=true,runAction=true,onOpenTab=true,onNudge=true';

/** Everything a caller can observe: the rendered props, their keys in order, the same-reference line; or `THROWN <the error's class>`. */
function outputOf(run: Run): string {
  const { input, result, thrown } = observe(run);
  if (result === undefined) return 'THROWN ' + (thrown as Error).constructor.name;
  return [render(result), Object.keys(result).join(','), referencesOf(result, input)].join('\n');
}

const ofChoice = (id: string, choice: Choice): Run => ({ id, input: () => inputOf(choice) });
const withBase = (id: string, changes: Partial<Choice>): Run => ofChoice(id, { ...BASE, ...changes });
/** The base input with one thing changed after it was built. */
const changed = (id: string, change: (input: Input) => Input, from: Choice = BASE): Run => ({ id, input: () => change(inputOf(from)) });
const without = (id: string, key: string, from: Choice = BASE): Run =>
  changed(
    id,
    (input) => {
      delete input.detail[key];
      return input;
    },
    from,
  );

// ---------------------------------------------------------------- named inputs

const D_T1 = {
  base: withBase('D-T1/base', {}),
  second: ofChoice('D-T1/second', SECOND),
};

const D_T2 = {
  finalApproval: POOLS.rendersReadyAt.map((rendersReadyAt, i) =>
    withBase(`D-T2/final_approval/rendersReadyAt/${i}`, { state: 'final_approval', rendersReadyAt }),
  ),
  conceptReview: POOLS.transitions.map((transitions, i) =>
    withBase(`D-T2/concept_review/transitions/${i}`, { state: 'concept_review', transitions }),
  ),
  otherStates: ['execution', 'created', 'survey', 'execution_decision', 'closed_design_only'].map((state) =>
    withBase(`D-T2/${state}/ignores-both`, { state, rendersReadyAt: POOLS.rendersReadyAt[1], transitions: POOLS.transitions[2] }),
  ),
  earlierCreation: withBase('D-T2/createdAt/1', { createdAt: POOLS.createdAt[1] }),
  noCreationDate: POOLS.state.map((state) => withBase(`D-T2/${state}/createdAt-not-a-date`, { state, createdAt: 'not a date' })),
};

const D_T3 = POOLS.clientDecision.map((clientDecision, d) =>
  POOLS.artifacts.map((artifacts, a) => withBase(`D-T3/${d}/${a}`, { clientDecision, artifacts })),
);

const THREE_TRIGGERS = POOLS.nextActions[2];
const ENDINGS = POOLS.nextActions[3];
const DESIGN_ANSWERS = POOLS.nextActions[4];
const D_T4 = {
  threeNoPrimary: withBase('D-T4/three/no-primary', { nextActions: THREE_TRIGGERS, primaryTrigger: null }),
  threeConfirm: withBase('D-T4/three/confirmConcept', { nextActions: THREE_TRIGGERS, primaryTrigger: 'confirmConcept' }),
  endings: POOLS.primaryTrigger.map((primaryTrigger, i) => withBase(`D-T4/endings/${i}`, { nextActions: ENDINGS, primaryTrigger })),
  designApprove: withBase('D-T4/design/approveDesign', { nextActions: DESIGN_ANSWERS, primaryTrigger: 'approveDesign' }),
};

const D_T5 = {
  base: withBase('D-T5/base', {}),
  paidInFull: withBase('D-T5/paid-in-full', { payments: POOLS.payments[1] }),
  paidInPart: withBase('D-T5/paid-400-of-1000', { payments: POOLS.payments[2] }),
  noMilestone: withBase('D-T5/no-milestone', { milestones: POOLS.milestones[1] }),
  twoMilestones: withBase('D-T5/two-milestones', { milestones: POOLS.milestones[2] }),
  noFeePaid: withBase('D-T5/no-design-fee/paid-in-full', { designFee: null, payments: POOLS.payments[1] }),
  noFeeTwo: withBase('D-T5/no-design-fee/two-milestones', { designFee: null, milestones: POOLS.milestones[2], payments: POOLS.payments[2] }),
  oneClaim: withBase('D-T5/one-claim', { paymentClaims: POOLS.paymentClaims[1] }),
  twoClaims: withBase('D-T5/two-claims', { paymentClaims: POOLS.paymentClaims[2] }),
  oneAwaiting: withBase('D-T5/awaiting-1', { awaitingReplyCount: 1 }),
  fourAwaiting: withBase('D-T5/awaiting-4', { awaitingReplyCount: 4 }),
  light: withBase('D-T5/entryPhase-execution', { entryPhase: 'execution' }),
  otherPhase: withBase('D-T5/entryPhase-other', { entryPhase: 'other' }),
  nullView: withBase('D-T5/execution-null', { execution: null }),
  undefinedView: withBase('D-T5/execution-undefined', { execution: undefined }),
  absentView: withBase('D-T5/execution-absent', { execution: ABSENT }),
  falseView: withBase('D-T5/execution-false', { execution: false }),
  zeroView: withBase('D-T5/execution-0', { execution: 0 }),
  emptyView: withBase('D-T5/execution-empty-string', { execution: '' }),
  lightNoFeeSchedule: without('D-T5/light-no-feeSchedule', 'feeSchedule', { ...BASE, entryPhase: 'execution' }),
  noViewNoFeeSchedule: without('D-T5/no-view-no-feeSchedule', 'feeSchedule', { ...BASE, execution: null }),
};

const FLAGS = ['canAdvance', 'canRecordOfflineApproval', 'canResolveClaims', 'canShare', 'canUpload', 'offPlan', 'clientHasEmail', 'pending'] as const;
const D_T6 = {
  paymentOnly: withBase('D-T6/recordPayment-only', { recordPayment: true, setRom: false }),
  romOnly: withBase('D-T6/setRom-only', { recordPayment: false, setRom: true }),
  flags: FLAGS.flatMap((flag) => [false, true].map((value) => withBase(`D-T6/${flag}/${value}`, { [flag]: value }))),
};

const D_T7 = {
  detailNull: changed('bad/detail-null', (input) => ({ ...input, detail: null as unknown as Input['detail'] })),
  detailUndefined: changed('bad/detail-undefined', (input) => ({ ...input, detail: undefined as unknown as Input['detail'] })),
  actionNull: changed('bad/action-null', (input) => ({ ...input, action: null })),
  actionUndefined: changed('bad/action-undefined', (input) => ({ ...input, action: undefined })),
  noHeader: without('bad/no-header', 'header'),
  noTransitions: without('bad/no-transitions', 'transitions'),
  noArtifacts: without('bad/no-artifacts', 'artifacts'),
  noGatePreview: without('bad/no-gatePreview', 'gatePreview'),
  noCapabilities: without('bad/no-capabilities', 'capabilities'),
  noNextActions: without('bad/no-nextActions', 'nextActions'),
  noFeeSchedule: without('bad/no-feeSchedule', 'feeSchedule'),
  noPayments: without('bad/no-payments', 'payments'),
  noPaymentClaims: without('bad/no-paymentClaims', 'paymentClaims'),
  noCreatedAt: changed('bad/no-createdAt', (input) => {
    delete (input.detail.header as Record<string, unknown>).createdAt;
    return input;
  }),
  noOpenTab: changed('bad/onOpenTab-undefined', (input) => ({ ...input, onOpenTab: undefined })),
};

// ------------------------------------------------------------------- the grid

const pairs = <K extends keyof Choice>(prefix: string, fixed: Partial<Choice>, keys: K[]): Run[] =>
  keys.flatMap((key) =>
    (POOLS[key] as readonly unknown[]).map((value, i) => withBase(`${prefix}/${String(key)}/${i}`, { ...fixed, [key]: value } as Partial<Choice>)),
  );

const everyState = POOLS.state.flatMap((state) =>
  pairs(`state/${state}`, { state }, ['rendersReadyAt', 'transitions', 'createdAt', 'entryPhase', 'execution']),
);
const everyPhase = POOLS.entryPhase.flatMap((entryPhase) =>
  pairs(`phase/${entryPhase}`, { entryPhase }, ['designFee', 'milestones', 'payments', 'paymentClaims', 'awaitingReplyCount', 'execution']),
);
const everyConcept = POOLS.clientDecision.flatMap((clientDecision, d) =>
  POOLS.artifacts.map((artifacts, a) => withBase(`concept/${d}/${a}`, { clientDecision, artifacts })),
);
const everySecondary = POOLS.primaryTrigger.flatMap((primaryTrigger, p) =>
  POOLS.nextActions.map((nextActions, n) => withBase(`secondary/${p}/${n}`, { primaryTrigger, nextActions })),
);

const RUNS: Run[] = [
  ...oneFactorAtATime(POOLS).map(({ id, choice }) => ofChoice(id, choice)),
  ...everyState,
  ...everyPhase,
  ...everyConcept,
  ...everySecondary,
  ...randomCases(POOLS, 20261118, 300).map(({ id, choice }) => ofChoice(id, choice)),
  ...Object.values(D_T1),
  ...D_T2.finalApproval,
  ...D_T2.conceptReview,
  ...D_T2.otherStates,
  D_T2.earlierCreation,
  ...D_T2.noCreationDate,
  ...D_T3.flat(),
  D_T4.threeNoPrimary,
  D_T4.threeConfirm,
  ...D_T4.endings,
  D_T4.designApprove,
  ...Object.values(D_T5),
  D_T6.paymentOnly,
  D_T6.romOnly,
  ...D_T6.flags,
  ...Object.values(D_T7),
];

// ------------------------------------------------------------------ the tests

const KEYS_IN_ORDER = [
  'engagementId',
  'projectId',
  'boqStep',
  'preview',
  'state',
  'allowances',
  'status',
  'canAdvance',
  'canRecordOfflineApproval',
  'reviewRoundStartedAt',
  'conceptOptions',
  'canRecordPayment',
  'canResolveClaims',
  'canShare',
  'canUpload',
  'clientHasEmail',
  'canSetOffPlan',
  'offPlan',
  'feeSplitPrefill',
  'paymentClaims',
  'awaitingReplyCount',
  'conceptOptionCount',
  'clientActivity',
  'secondaryTriggers',
  'pending',
  'runAction',
  'actionError',
  'onNudge',
  'clientExpected',
  'execution',
  'onOpenTab',
];

const CREATED = '2026-10-01T09:00:00.000Z';
const startOf = (run: Run) => propsOf(run).reviewRoundStartedAt;
const thrownBy = (run: Run) => outputOf(run);

describe('commandCardPropsOf, the grid', () => {
  it('digests as recorded for every case: the props, their order and what is the same reference', () => {
    expect(new Set(RUNS.map((run) => run.id)).size).toBe(RUNS.length);
    expect([everyState.length, everyPhase.length, everyConcept.length, everySecondary.length]).toEqual([196, 69, 15, 15]);
    const digests = Object.fromEntries(RUNS.map((run) => [run.id, digestOf(outputOf(run))]));
    expect(digests).toEqual(recorded);
  });
});

describe('commandCardPropsOf, the whole result', () => {
  it('D-T1: the base: 31 props in order, every loaded object handed on as itself', () => {
    const { input, result } = observe(D_T1.base);
    expect(result).toEqual({
      engagementId: 'e-1',
      projectId: 'p-1',
      boqStep: { current: null },
      preview: { clientDecision: null, primaryTrigger: null, items: [] },
      state: 'execution',
      allowances: { revisionCount: 0, freeRevisionN: 2, designRevisionCount: 0, freeDesignRevisionN: 1 },
      status: 'your_move',
      canAdvance: false,
      canRecordOfflineApproval: false,
      reviewRoundStartedAt: '2026-10-01T09:00:00.000Z',
      conceptOptions: [],
      canRecordPayment: true,
      canResolveClaims: false,
      canShare: false,
      canUpload: false,
      clientHasEmail: true,
      canSetOffPlan: true,
      offPlan: false,
      feeSplitPrefill: null,
      paymentClaims: [],
      awaitingReplyCount: 0,
      conceptOptionCount: 0,
      clientActivity: [],
      secondaryTriggers: [],
      pending: false,
      runAction: runA,
      actionError: null,
      onNudge: openDeliveryReminder,
      clientExpected: null,
      execution: { view: { stage: 'in_progress' }, designSummary: { openInstalments: 1, pendingClaims: 0, awaitingReply: 0 } },
      onOpenTab: tabA,
    });
    expect(Object.keys(result as Result)).toEqual(KEYS_IN_ORDER);
    expect(referencesOf(result as Result, input)).toBe(ALL_THE_SAME);
  });

  it('D-T1: the second value of every input: the same 31 props in order, every loaded object handed on as itself', () => {
    const { input, result } = observe(D_T1.second);
    expect(result).toEqual({
      engagementId: 'e-2',
      projectId: 'p-2',
      boqStep: { current: { documentNumber: 'BQ-2026-0007' } },
      preview: { clientDecision: { kind: 'concept_approval' }, primaryTrigger: 'confirmConcept', items: [] },
      state: 'created',
      allowances: { revisionCount: 3, freeRevisionN: 5, designRevisionCount: 4, freeDesignRevisionN: 6 },
      status: 'waiting_on_client',
      canAdvance: true,
      canRecordOfflineApproval: true,
      reviewRoundStartedAt: '2026-09-15T07:45:00.000Z',
      conceptOptions: [],
      canRecordPayment: false,
      canResolveClaims: true,
      canShare: true,
      canUpload: true,
      clientHasEmail: false,
      canSetOffPlan: false,
      offPlan: true,
      feeSplitPrefill: { rows: [1] },
      paymentClaims: [{ id: 'c1' }],
      awaitingReplyCount: 1,
      conceptOptionCount: 1,
      clientActivity: [{ at: 'x' }],
      secondaryTriggers: [],
      pending: true,
      runAction: runB,
      actionError: { code: 'generic', reference: 'r-1' },
      onNudge: openDeliveryReminder,
      clientExpected: { date: '2026-12-01' },
      execution: { view: { stage: 'contract_sent', flow: { a: 1 } }, designSummary: null },
      onOpenTab: tabB,
    });
    expect(Object.keys(result as Result)).toEqual(KEYS_IN_ORDER);
    expect(referencesOf(result as Result, input)).toBe(ALL_THE_SAME);
  });
});

describe('commandCardPropsOf, the review-round start', () => {
  it('D-T2: at final_approval it is the renders date, else the creation date; an empty string throws', () => {
    const [nullDate, october, november, undefinedDate, empty] = D_T2.finalApproval;
    expect(startOf(nullDate)).toBe(CREATED);
    expect(startOf(october)).toBe('2026-10-05T08:00:00.000Z');
    expect(startOf(november)).toBe('2026-11-01T12:30:00.000Z');
    expect(startOf(undefinedDate)).toBe(CREATED);
    expect(thrownBy(empty)).toBe('THROWN RangeError');
  });

  it('D-T2: at concept_review it is the date of the FIRST transition into that state, else the creation date', () => {
    const [none, one, two, stringDate, otherState, nullDate, undefinedDate, nullState, invalidDate] = D_T2.conceptReview;
    expect(startOf(none)).toBe(CREATED);
    expect(startOf(one)).toBe('2026-10-03T10:00:00.000Z');
    // Two entries: the first in the list, which is the newer one here.
    expect(startOf(two)).toBe('2026-10-09T10:00:00.000Z');
    expect(startOf(stringDate)).toBe('2026-10-04T11:00:00.000Z');
    expect(startOf(otherState)).toBe(CREATED);
    expect(startOf(nullDate)).toBe(CREATED);
    expect(startOf(undefinedDate)).toBe(CREATED);
    expect(startOf(nullState)).toBe(CREATED);
    expect(thrownBy(invalidDate)).toBe('THROWN RangeError');
  });

  it('D-T2: at every other state the renders date and the transitions are ignored', () => {
    expect(D_T2.otherStates).toHaveLength(5);
    for (const run of D_T2.otherStates) {
      expect([run.id, startOf(run)]).toEqual([run.id, CREATED]);
    }
  });

  it('D-T2: follows the creation date, and throws in every state when it is not a date', () => {
    expect(startOf(D_T2.earlierCreation)).toBe('2026-09-15T07:45:00.000Z');
    expect(D_T2.noCreationDate).toHaveLength(7);
    for (const run of D_T2.noCreationDate) {
      expect([run.id, thrownBy(run)]).toEqual([run.id, 'THROWN RangeError']);
    }
  });
});

describe('commandCardPropsOf, the concept options and the secondary triggers', () => {
  it('D-T3: offers the lettered options in letter order while the client has not answered, and none once they have', () => {
    const lettered = [
      [],
      [{ id: 'a1', letter: 'A' }],
      // Letter order, not list order; the render has no letter.
      [
        { id: 'a1', letter: 'A' },
        { id: 'a2', letter: 'B' },
      ],
      // An option without a position has no letter.
      [],
      [
        { id: 'a1', letter: 'A' },
        { id: 'a2', letter: 'B' },
        { id: 'a3', letter: 'C' },
        { id: 'a4', letter: 'D' },
      ],
    ];
    const [noDecision, approved, changesRequested] = D_T3;
    expect(noDecision.map((run) => propsOf(run).conceptOptions)).toEqual(lettered);
    expect(approved.map((run) => propsOf(run).conceptOptions)).toEqual([[], [], [], [], []]);
    expect(changesRequested.map((run) => propsOf(run).conceptOptions)).toEqual([[], [], [], [], []]);
  });

  it('D-T3: counts every concept option, lettered or not, whatever the client decided', () => {
    for (const byArtifacts of D_T3) {
      expect(byArtifacts.map((run) => propsOf(run).conceptOptionCount)).toEqual([0, 1, 2, 1, 4]);
    }
  });

  it('D-T4: every permitted trigger but the primary one and the endings is secondary, in order', () => {
    expect(propsOf(D_T4.threeNoPrimary).secondaryTriggers).toEqual(['confirmConcept', 'requestRevision', 'abandon']);
    expect(propsOf(D_T4.threeConfirm).secondaryTriggers).toEqual(['requestRevision', 'abandon']);
    expect(D_T4.endings.map((run) => propsOf(run).secondaryTriggers)).toEqual([['abandon'], ['abandon'], ['abandon']]);
    expect(propsOf(D_T4.designApprove).secondaryTriggers).toEqual(['rejectDesign']);
  });
});

describe('commandCardPropsOf, the execution cockpit', () => {
  it('D-T5: is the view itself and the design summary for a delivery that began with a design', () => {
    const { input, result } = observe(D_T5.base);
    expect(result?.execution).toEqual({
      view: { stage: 'in_progress' },
      designSummary: { openInstalments: 1, pendingClaims: 0, awaitingReply: 0 },
    });
    expect((result?.execution as Result).view).toBe(input.detail.execution);
  });

  it('D-T5: counts an instalment as open until it is paid in full, and always when there is no design fee', () => {
    const summaryOf = (run: Run) => (propsOf(run).execution as Result).designSummary;
    expect(summaryOf(D_T5.paidInFull)).toEqual({ openInstalments: 0, pendingClaims: 0, awaitingReply: 0 });
    expect(summaryOf(D_T5.paidInPart)).toEqual({ openInstalments: 1, pendingClaims: 0, awaitingReply: 0 });
    expect(summaryOf(D_T5.noMilestone)).toEqual({ openInstalments: 0, pendingClaims: 0, awaitingReply: 0 });
    expect(summaryOf(D_T5.twoMilestones)).toEqual({ openInstalments: 2, pendingClaims: 0, awaitingReply: 0 });
    // No design fee: the amount cannot be computed, so even a paid instalment is open.
    expect(summaryOf(D_T5.noFeePaid)).toEqual({ openInstalments: 1, pendingClaims: 0, awaitingReply: 0 });
    expect(summaryOf(D_T5.noFeeTwo)).toEqual({ openInstalments: 2, pendingClaims: 0, awaitingReply: 0 });
  });

  it('D-T5: counts the pending claims and the questions awaiting a reply', () => {
    const summaryOf = (run: Run) => (propsOf(run).execution as Result).designSummary;
    expect(summaryOf(D_T5.oneClaim)).toEqual({ openInstalments: 1, pendingClaims: 1, awaitingReply: 0 });
    expect(summaryOf(D_T5.twoClaims)).toEqual({ openInstalments: 1, pendingClaims: 2, awaitingReply: 0 });
    expect(summaryOf(D_T5.oneAwaiting)).toEqual({ openInstalments: 1, pendingClaims: 0, awaitingReply: 1 });
    expect(summaryOf(D_T5.fourAwaiting)).toEqual({ openInstalments: 1, pendingClaims: 0, awaitingReply: 4 });
  });

  it('D-T5: has no design summary unless the delivery began with a design', () => {
    expect(propsOf(D_T5.light).execution).toEqual({ view: { stage: 'in_progress' }, designSummary: null });
    expect(propsOf(D_T5.otherPhase).execution).toEqual({ view: { stage: 'in_progress' }, designSummary: null });
  });

  it('D-T5: hands a missing view on as it is: null, undefined (the key present), false, 0, the empty string', () => {
    expect(propsOf(D_T5.nullView).execution).toBeNull();
    for (const run of [D_T5.undefinedView, D_T5.absentView]) {
      const props = propsOf(run);
      expect([run.id, 'execution' in props, props.execution]).toEqual([run.id, true, undefined]);
      expect(Object.keys(props)).toEqual(KEYS_IN_ORDER);
    }
    expect(propsOf(D_T5.falseView).execution).toBe(false);
    expect(propsOf(D_T5.zeroView).execution).toBe(0);
    expect(propsOf(D_T5.emptyView).execution).toBe('');
  });

  it('D-T5: never asks for the summary of a light delivery, or when there is no view: no fee schedule is needed', () => {
    expect(propsOf(D_T5.lightNoFeeSchedule).execution).toEqual({ view: { stage: 'in_progress' }, designSummary: null });
    expect(propsOf(D_T5.noViewNoFeeSchedule).execution).toBeNull();
  });
});

describe('commandCardPropsOf, the flags', () => {
  it('D-T6: canRecordPayment follows capabilities.recordPayment and canSetOffPlan follows capabilities.setRom', () => {
    const paymentOnly = propsOf(D_T6.paymentOnly);
    expect([paymentOnly.canRecordPayment, paymentOnly.canSetOffPlan]).toEqual([true, false]);
    const romOnly = propsOf(D_T6.romOnly);
    expect([romOnly.canRecordPayment, romOnly.canSetOffPlan]).toEqual([false, true]);
  });

  it('D-T6: hands each flag on at both values', () => {
    expect(D_T6.flags).toHaveLength(16);
    for (const [i, run] of D_T6.flags.entries()) {
      const flag = FLAGS[Math.floor(i / 2)];
      expect([run.id, propsOf(run)[flag]]).toEqual([run.id, i % 2 === 1]);
    }
  });
});

describe('commandCardPropsOf, bad input', () => {
  it('D-T7: throws a TypeError naming the header when there is no detail', () => {
    for (const run of [D_T7.detailNull, D_T7.detailUndefined]) {
      const { thrown } = observe(run);
      expect([run.id, outputOf(run)]).toEqual([run.id, 'THROWN TypeError']);
      expect((thrown as Error).message).toMatch(/'header' of 'detail'/);
    }
  });

  it('D-T7: throws a TypeError when a part it reads is missing', () => {
    const missing = [
      D_T7.actionNull,
      D_T7.actionUndefined,
      D_T7.noHeader,
      D_T7.noTransitions,
      D_T7.noArtifacts,
      D_T7.noGatePreview,
      D_T7.noCapabilities,
      D_T7.noNextActions,
      // A design delivery with a view needs these three for its summary.
      D_T7.noFeeSchedule,
      D_T7.noPayments,
      D_T7.noPaymentClaims,
    ];
    for (const run of missing) {
      expect([run.id, outputOf(run)]).toEqual([run.id, 'THROWN TypeError']);
    }
  });

  it('D-T7: throws a RangeError when there is no creation date', () => {
    expect(outputOf(D_T7.noCreatedAt)).toBe('THROWN RangeError');
  });

  it('D-T7: resolves without a tab callback, the key present', () => {
    const props = propsOf(D_T7.noOpenTab);
    expect(['onOpenTab' in props, props.onOpenTab]).toEqual([true, undefined]);
    expect(Object.keys(props)).toEqual(KEYS_IN_ORDER);
  });
});
