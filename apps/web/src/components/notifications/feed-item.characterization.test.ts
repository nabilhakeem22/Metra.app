// CHARACTERIZATION of notificationBody: the sentence it returns AND every call
// it makes to the three callbacks it is handed (the translator, the date
// formatter, the milestone namer), with each argument rendered and in call
// order. Written against the function as it stood BEFORE the digest sentence
// was named, and not edited since: a refactor that changes a sentence, a key, a
// value or its type (the string "3" against the number 3), the order of two
// calls, whether a call is made at all, or the error for a bad input fails
// here.
//
// Two layers; the outputs are short, so the whole outputs are inline literals.
// Named scenarios compare the sentence and the WHOLE call journal against
// literals. A generated grid (every key with two full param sets and none, the
// callback modes, each param swept through its values, 300 seeded random cases,
// and every named input) is compared by digest
// (feed-item.golden-digests.json). Every digest is the unsplit function's own
// output.
//
// No module is doubled: the client-responded sentences, the delivery label and
// the actor label run for real. The three callbacks are journalling doubles
// built per case.
import { describe, expect, it } from 'vitest';
import { CLIENT_RESPONDED_BODY_KEYS } from '@/lib/notifications/kinds';
import { digestOf, randomCases } from '@/test/golden-cases';
import { ABSENT } from '@/test/priced-document-cases';
import { createRecordingTx } from '@/test/recording-tx';
import { notificationBody, type FeedItem } from './feed-item';
import recorded from './feed-item.golden-digests.json';

// 3 and "3" render differently.
const { render } = createRecordingTx();

/** How the translator and the date formatter answer in one case. */
type Mode = 'echo' | 'blank-first' | 'blank-second' | 'blank-all' | 'throw-first' | 'throw-second' | 'date-throws';

/** The three callbacks, journalling: every call lands in `calls`, in call order. */
function callbacksOf(mode: Mode) {
  const calls: string[] = [];
  let n = 0;
  const translate = (key: string, values?: Record<string, string | number>): string => {
    n += 1;
    calls.push(`translate#${n} ${key} ${render(values)}`);
    if ((mode === 'throw-first' && n === 1) || (mode === 'throw-second' && n === 2)) throw new Error('catalogue: ' + key);
    if (mode === 'blank-all' || (mode === 'blank-first' && n === 1) || (mode === 'blank-second' && n === 2)) return '';
    return `[${key} ${Object.entries(values ?? {})
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(',')}]`;
  };
  const formatDate = (iso: string): string => {
    calls.push(`formatDate ${render(iso)}`);
    if (mode === 'date-throws') throw new RangeError('bad date ' + iso);
    return 'D:' + iso;
  };
  const milestoneLabel = (kind: string): string | null => {
    calls.push(`milestoneLabel ${render(kind)}`);
    return kind === 'deposit' ? 'Deposit' : null;
  };
  return { calls, translate, formatDate, milestoneLabel };
}

// ------------------------------------------------------------------- fixtures

const OWN_KEYS = [
  'proposal_expiring',
  'proposal_followup',
  'portfolio_digest',
  'delivery_waiting_on_client',
  'client_page_details_changed',
  'stage_reminder',
];
const OTHER_KEYS = ['not_a_kind', '', 'portfolio_digest_deliveries', 'toString', '__proto__', 'PROPOSAL_EXPIRING', 'stage_reminder '];

type Params = Record<string, unknown>;

const FULL_A: Params = {
  number: 12,
  expiryDate: '2026-10-01',
  days: 3,
  activeProjects: 4,
  awaitingResponse: 2,
  expiringSoon: 1,
  overdueStages: 5,
  deliveriesYourMove: 3,
  deliveriesWaiting: 1,
  deliveriesStalled: 0,
  actor: { name: 'Sara', email: 'sara@studio.test' },
  overdueCount: 2,
  upcomingCount: 6,
  year: 2026,
  titleAr: 'مطبخ الفيلا',
  titleEn: 'Villa kitchen',
  milestoneKind: 'deposit',
  optionPosition: 2,
  count: 1,
};
const FULL_B: Params = {
  number: 7,
  expiryDate: '2027-01-15',
  days: 11,
  activeProjects: 9,
  awaitingResponse: 8,
  expiringSoon: 7,
  overdueStages: 6,
  deliveriesYourMove: 12,
  deliveriesWaiting: 2,
  deliveriesStalled: 1,
  actor: { name: 'Omar', email: 'omar@studio.test' },
  overdueCount: 0,
  upcomingCount: 1,
  year: 2027,
  titleAr: 'شقة التجمع',
  titleEn: 'Tagamoa flat',
  milestoneKind: 'mystery',
  optionPosition: 1,
  count: 4,
  budget: 'pending',
};
const SCALARS: unknown[] = [ABSENT, undefined, null, 0, 1, 2, 12, -3, 2.5, NaN, Infinity, '', '0', '7', 'abc', true, false, {}, [3]];
const TITLES: unknown[] = [ABSENT, null, '', '  ', 'مطبخ الفيلا', 'Villa kitchen'];
const ACTORS: unknown[] = [
  ABSENT,
  undefined,
  null,
  'Sara <sara@studio.test>',
  {},
  { name: 'Sara', email: 'sara@studio.test' },
  { name: 'Omar', email: 'omar@studio.test' },
  { name: 'Sara', email: null },
  { name: null, email: 'x@y.test' },
  { name: 5, email: 'five@studio.test' },
  { name: 'Mona', email: 7 },
  { email: 'only@studio.test' },
];
/** The params each own key reads, and the values each is swept through. */
const READS: Record<string, Array<[param: string, values: unknown[]]>> = {
  proposal_expiring: [
    ['number', SCALARS],
    ['expiryDate', SCALARS],
  ],
  proposal_followup: [
    ['number', SCALARS],
    ['days', SCALARS],
  ],
  portfolio_digest: [
    ['activeProjects', SCALARS],
    ['awaitingResponse', SCALARS],
    ['expiringSoon', SCALARS],
    ['overdueStages', SCALARS],
    ['deliveriesYourMove', SCALARS],
    ['deliveriesWaiting', SCALARS],
    ['deliveriesStalled', SCALARS],
  ],
  delivery_waiting_on_client: [
    ['days', SCALARS],
    ['number', SCALARS],
    ['year', SCALARS],
    ['titleAr', TITLES],
    ['titleEn', TITLES],
  ],
  client_page_details_changed: [['actor', ACTORS]],
  stage_reminder: [
    ['overdueCount', SCALARS],
    ['upcomingCount', SCALARS],
  ],
};

/** `base` with one param set, or left off for ABSENT. A fresh object every time. */
function paramsWith(base: Params, param: string, value: unknown): Params {
  const params = { ...base };
  if (value === ABSENT) delete params[param];
  else params[param] = value;
  return params;
}

// ----------------------------------------------------------------- one call

/** One call: the item it is made with (built fresh), the locale, and how the callbacks answer. */
interface Run {
  id: string;
  item: () => unknown;
  locale: string;
  mode: Mode;
}

const itemOf = (bodyKey: unknown, params: unknown) => ({
  id: 'n1',
  kind: 'k',
  bodyKey,
  params,
  entityType: 'engagement',
  entityId: 'e-1',
  createdAt: '2026-09-01T10:00:00Z',
  read: false,
});

const run = (id: string, bodyKey: string, params: Params, locale = 'en', mode: Mode = 'echo'): Run => ({
  id,
  item: () => itemOf(bodyKey, structuredClone(params)),
  locale,
  mode,
});

interface Observed {
  /** The returned sentence; undefined when the call threw. */
  sentence: string | undefined;
  thrown: unknown;
  calls: string[];
}

function observe({ item, locale, mode }: Run): Observed {
  const { calls, translate, formatDate, milestoneLabel } = callbacksOf(mode);
  try {
    return { sentence: notificationBody(item() as FeedItem, translate, formatDate, locale, milestoneLabel), thrown: null, calls };
  } catch (thrown) {
    return { sentence: undefined, thrown, calls };
  }
}

/** Everything a caller can observe: the sentence (or the error's class), then one line per callback call, in call order. */
function outputOf(one: Run): string {
  const { sentence, thrown, calls } = observe(one);
  const outcome = thrown === null ? 'OK ' + render(sentence) : 'THROWN ' + (thrown as Error).constructor.name;
  return outcome + '\n' + calls.join('\n');
}

// ---------------------------------------------------------------- named inputs

const N_T1 = {
  a: run('N-T1/A', 'proposal_expiring', FULL_A),
  b: run('N-T1/B', 'proposal_expiring', FULL_B),
  none: run('N-T1/empty', 'proposal_expiring', {}),
  zeroDate: run('N-T1/expiryDate-0', 'proposal_expiring', paramsWith(FULL_A, 'expiryDate', 0)),
  emptyNumber: run('N-T1/number-empty', 'proposal_expiring', paramsWith(FULL_A, 'number', '')),
};

const N_T2 = {
  a: run('N-T2/A', 'proposal_followup', FULL_A),
  b: run('N-T2/B', 'proposal_followup', FULL_B),
};

const digestWith = (name: string, value: unknown, mode: Mode = 'echo') =>
  run(`N-T3/${name}`, 'portfolio_digest', paramsWith(FULL_A, 'deliveriesYourMove', value), 'en', mode);
const N_T3 = {
  a: run('N-T3/A', 'portfolio_digest', FULL_A),
  b: run('N-T3/B', 'portfolio_digest', FULL_B),
  none: run('N-T3/empty', 'portfolio_digest', {}),
  oneCall: [
    digestWith('yourMove-absent', ABSENT),
    digestWith('yourMove-undefined', undefined),
    digestWith('yourMove-null', null),
    digestWith('yourMove-string', '7'),
    digestWith('yourMove-true', true),
  ],
  zero: digestWith('yourMove-0', 0),
  notANumber: digestWith('yourMove-NaN', NaN),
  blankFirst: run('N-T3/blank-first', 'portfolio_digest', FULL_A, 'en', 'blank-first'),
  blankSecond: run('N-T3/blank-second', 'portfolio_digest', FULL_A, 'en', 'blank-second'),
  blankAll: run('N-T3/blank-all', 'portfolio_digest', FULL_A, 'en', 'blank-all'),
  throwSecond: run('N-T3/throw-second', 'portfolio_digest', FULL_A, 'en', 'throw-second'),
};

const waitingWith = (name: string, value: unknown) =>
  run(`N-T4/${name}`, 'delivery_waiting_on_client', paramsWith(FULL_A, 'days', value));
const N_T4 = {
  en: run('N-T4/A/en', 'delivery_waiting_on_client', FULL_A, 'en'),
  ar: run('N-T4/A/ar-EG', 'delivery_waiting_on_client', FULL_A, 'ar-EG'),
  days: [waitingWith('days-0', 0), waitingWith('days-1', 1), waitingWith('days-2', 2), waitingWith('days-12', 12)],
  stringDays: waitingWith('days-string', '7'),
  noDays: waitingWith('days-absent', ABSENT),
};

const detailsWith = (name: string, actor: unknown) =>
  run(`N-T5/${name}`, 'client_page_details_changed', paramsWith(FULL_A, 'actor', actor));
const N_T5 = {
  a: run('N-T5/A', 'client_page_details_changed', FULL_A),
  b: run('N-T5/B', 'client_page_details_changed', FULL_B),
  nameOnly: detailsWith('name-without-email', { name: 'Sara', email: null }),
  emailOnly: detailsWith('email-without-name', { name: null, email: 'x@y.test' }),
  nameNotAString: detailsWith('name-not-a-string', { name: 5, email: 'five@studio.test' }),
  nobody: detailsWith('no-actor', ABSENT),
};

const N_T6 = {
  a: run('N-T6/A', 'stage_reminder', FULL_A),
  b: run('N-T6/B', 'stage_reminder', FULL_B),
  none: run('N-T6/empty', 'stage_reminder', {}),
};

const N_T7 = OTHER_KEYS.map((bodyKey, i) => run(`N-T7/${i}`, bodyKey, FULL_A));

const N_T8 = {
  en: run('N-T8/client_payment_claimed/en', 'client_payment_claimed', FULL_A, 'en'),
  ar: run('N-T8/client_payment_claimed/ar-EG', 'client_payment_claimed', FULL_A, 'ar-EG'),
};

// N-T9: bad input, in both locales.
const LOCALES = ['en', 'ar-EG'];
const broken = (name: string, item: () => unknown): Run[] =>
  LOCALES.map((locale) => ({ id: `bad/${name}/${locale}`, item, locale, mode: 'echo' as const }));
const N_T9 = {
  itemNull: broken('item-null', () => null),
  itemUndefined: broken('item-undefined', () => undefined),
  noParamsOwnKey: OWN_KEYS.flatMap((bodyKey) => broken(`params-null-${bodyKey}`, () => itemOf(bodyKey, null))),
  noParamsUnknownKey: broken('params-null-unknown-key', () => itemOf('not_a_kind', null)),
  noBodyKey: broken('bodyKey-undefined', () => itemOf(undefined, { ...FULL_A })),
};

// ------------------------------------------------------------------- the grid

const FULL_SETS: Array<[name: string, params: Params]> = [
  ['A', FULL_A],
  ['B', FULL_B],
  ['empty', {}],
];
const everyKeyFull = [...OWN_KEYS, ...OTHER_KEYS, ...CLIENT_RESPONDED_BODY_KEYS].flatMap((bodyKey) =>
  LOCALES.flatMap((locale) => FULL_SETS.map(([name, params]) => run(`full/${bodyKey}/${locale}/${name}`, bodyKey, params, locale))),
);

const OTHER_MODES: Mode[] = ['blank-first', 'blank-second', 'blank-all', 'throw-first', 'throw-second', 'date-throws'];
const everyMode = OWN_KEYS.flatMap((bodyKey) =>
  LOCALES.flatMap((locale) =>
    FULL_SETS.filter(([name]) => name !== 'B').flatMap(([name, params]) =>
      OTHER_MODES.map((mode) => run(`mode/${bodyKey}/${locale}/${name}/${mode}`, bodyKey, params, locale, mode)),
    ),
  ),
);

const oneParamAtATime = OWN_KEYS.flatMap((bodyKey) =>
  READS[bodyKey].flatMap(([param, values]) =>
    values.map((value, i) =>
      run(
        `one/${bodyKey}/${param}/${i}`,
        bodyKey,
        paramsWith(FULL_A, param, value),
        bodyKey === 'delivery_waiting_on_client' && i % 2 === 1 ? 'ar-EG' : 'en',
      ),
    ),
  ),
);

// One pool per param name of FULL_B: the union of every value a param is swept through.
const ANY_VALUE = [...new Set([...SCALARS, ...TITLES, ...ACTORS, 'deposit', 'pending'])];
const RANDOM_POOLS: Record<string, readonly unknown[]> = {
  bodyKey: [...OWN_KEYS, ...OWN_KEYS, ...OTHER_KEYS, ...CLIENT_RESPONDED_BODY_KEYS],
  locale: ['en', 'ar-EG', 'ar', 'fr'],
  mode: ['echo', 'echo', 'echo', 'blank-first', 'blank-second', 'blank-all'],
  ...Object.fromEntries(Object.keys(FULL_B).map((param) => [param, ANY_VALUE])),
};
const random = randomCases(RANDOM_POOLS, 20261117, 300).map(({ id, choice }): Run => {
  const { bodyKey, locale, mode, ...picked } = choice;
  const params = Object.fromEntries(Object.entries(picked).filter(([, value]) => value !== ABSENT));
  return run(id, bodyKey as string, params, locale as string, mode as Mode);
});

const RUNS: Run[] = [
  ...everyKeyFull,
  ...everyMode,
  ...oneParamAtATime,
  ...random,
  ...Object.values(N_T1),
  ...Object.values(N_T2),
  N_T3.a,
  N_T3.b,
  N_T3.none,
  ...N_T3.oneCall,
  N_T3.zero,
  N_T3.notANumber,
  N_T3.blankFirst,
  N_T3.blankSecond,
  N_T3.blankAll,
  N_T3.throwSecond,
  N_T4.en,
  N_T4.ar,
  ...N_T4.days,
  N_T4.stringDays,
  N_T4.noDays,
  ...Object.values(N_T5),
  ...Object.values(N_T6),
  ...N_T7,
  ...Object.values(N_T8),
  ...Object.values(N_T9).flat(),
];

// ------------------------------------------------------------------ the tests

/** The sentence and the whole journal of a call that returned. */
const said = (sentence: string, ...calls: string[]) => ({ sentence, thrown: null, calls });

// The delivery's label: its number between two bidi isolates, then its title.
const DELIVERY_EN = '\u2068DE-2026-0012\u2069 · Villa kitchen';
const DELIVERY_AR = '\u2068DE-2026-0012\u2069 · مطبخ الفيلا';

const DIGEST_A = '[portfolio_digest active=4,awaiting=2,expiring=1,overdue=5]';
const DIGEST_A_CALL = 'translate#1 portfolio_digest {active: "4", awaiting: "2", expiring: "1", overdue: "5"}';
const DELIVERIES_A =
  '[portfolio_digest_deliveries yourMoveCount=3,yourMove=3,waitingCount=1,waiting=1,stalledCount=0,stalled=0]';
const DELIVERIES_A_CALL =
  'translate#2 portfolio_digest_deliveries {yourMoveCount: 3, yourMove: "3", waitingCount: 1, waiting: "1", stalledCount: 0, stalled: "0"}';

describe('notificationBody, the grid', () => {
  it('digests as recorded for every case: the sentence and every callback call', () => {
    expect(new Set(RUNS.map((one) => one.id)).size).toBe(RUNS.length);
    expect([everyKeyFull.length, everyMode.length, oneParamAtATime.length, random.length]).toEqual([156, 144, 328, 300]);
    const digests = Object.fromEntries(RUNS.map((one) => [one.id, digestOf(outputOf(one))]));
    expect(digests).toEqual(recorded);
  });
});

describe('notificationBody, its own sentences', () => {
  it('N-T1 expiring: formats the date FIRST, then translates with the number as a string', () => {
    expect(observe(N_T1.a)).toEqual(
      said(
        '[proposal_expiring number=12,date=D:2026-10-01]',
        'formatDate "2026-10-01"',
        'translate#1 proposal_expiring {number: "12", date: "D:2026-10-01"}',
      ),
    );
    expect(observe(N_T1.b)).toEqual(
      said(
        '[proposal_expiring number=7,date=D:2027-01-15]',
        'formatDate "2027-01-15"',
        'translate#1 proposal_expiring {number: "7", date: "D:2027-01-15"}',
      ),
    );
    // No params: an empty date, and 0 for the number.
    expect(observe(N_T1.none)).toEqual(
      said('[proposal_expiring number=0,date=D:]', 'formatDate ""', 'translate#1 proposal_expiring {number: "0", date: "D:"}'),
    );
    // A date of 0 is kept (only null and undefined read as empty); an empty number stays empty.
    expect(observe(N_T1.zeroDate)).toEqual(
      said('[proposal_expiring number=12,date=D:0]', 'formatDate "0"', 'translate#1 proposal_expiring {number: "12", date: "D:0"}'),
    );
    expect(observe(N_T1.emptyNumber)).toEqual(
      said(
        '[proposal_expiring number=,date=D:2026-10-01]',
        'formatDate "2026-10-01"',
        'translate#1 proposal_expiring {number: "", date: "D:2026-10-01"}',
      ),
    );
  });

  it('N-T2 follow-up: one call, the number and the days as strings', () => {
    expect(observe(N_T2.a)).toEqual(
      said('[proposal_followup number=12,days=3]', 'translate#1 proposal_followup {number: "12", days: "3"}'),
    );
    expect(observe(N_T2.b)).toEqual(
      said('[proposal_followup number=7,days=11]', 'translate#1 proposal_followup {number: "7", days: "11"}'),
    );
  });

  it('N-T3 digest: the digest sentence FIRST, then the delivery counts, joined by one space', () => {
    expect(observe(N_T3.a)).toEqual(said(`${DIGEST_A} ${DELIVERIES_A}`, DIGEST_A_CALL, DELIVERIES_A_CALL));
    expect(observe(N_T3.b)).toEqual(
      said(
        '[portfolio_digest active=9,awaiting=8,expiring=7,overdue=6] [portfolio_digest_deliveries yourMoveCount=12,yourMove=12,waitingCount=2,waiting=2,stalledCount=1,stalled=1]',
        'translate#1 portfolio_digest {active: "9", awaiting: "8", expiring: "7", overdue: "6"}',
        'translate#2 portfolio_digest_deliveries {yourMoveCount: 12, yourMove: "12", waitingCount: 2, waiting: "2", stalledCount: 1, stalled: "1"}',
      ),
    );
  });

  it('N-T3 digest: asks for the delivery counts only when deliveriesYourMove is a NUMBER', () => {
    expect(observe(N_T3.none)).toEqual(
      said(
        '[portfolio_digest active=0,awaiting=0,expiring=0,overdue=0]',
        'translate#1 portfolio_digest {active: "0", awaiting: "0", expiring: "0", overdue: "0"}',
      ),
    );
    expect(N_T3.oneCall).toHaveLength(5);
    for (const one of N_T3.oneCall) {
      expect([one.id, observe(one)]).toEqual([one.id, said(DIGEST_A, DIGEST_A_CALL)]);
    }
    expect(observe(N_T3.zero)).toEqual(
      said(
        `${DIGEST_A} [portfolio_digest_deliveries yourMoveCount=0,yourMove=0,waitingCount=1,waiting=1,stalledCount=0,stalled=0]`,
        DIGEST_A_CALL,
        'translate#2 portfolio_digest_deliveries {yourMoveCount: 0, yourMove: "0", waitingCount: 1, waiting: "1", stalledCount: 0, stalled: "0"}',
      ),
    );
    // NaN is a number: the counts are asked for, the plural reads 0 and the figure reads "NaN".
    expect(observe(N_T3.notANumber)).toEqual(
      said(
        `${DIGEST_A} [portfolio_digest_deliveries yourMoveCount=0,yourMove=NaN,waitingCount=1,waiting=1,stalledCount=0,stalled=0]`,
        DIGEST_A_CALL,
        'translate#2 portfolio_digest_deliveries {yourMoveCount: 0, yourMove: "NaN", waitingCount: 1, waiting: "1", stalledCount: 0, stalled: "0"}',
      ),
    );
  });

  it('N-T3 digest: leaves out a sentence that comes back empty, with no stray space', () => {
    expect(observe(N_T3.blankFirst)).toEqual(said(DELIVERIES_A, DIGEST_A_CALL, DELIVERIES_A_CALL));
    expect(observe(N_T3.blankSecond)).toEqual(said(DIGEST_A, DIGEST_A_CALL, DELIVERIES_A_CALL));
    expect(observe(N_T3.blankAll)).toEqual(said('', DIGEST_A_CALL, DELIVERIES_A_CALL));
  });

  it('N-T3 digest: an error from the second sentence leaves the function after both calls were made', () => {
    const observed = observe(N_T3.throwSecond);
    expect(observed.sentence).toBeUndefined();
    expect(observed.thrown).toEqual(new Error('catalogue: portfolio_digest_deliveries'));
    expect(observed.calls).toEqual([DIGEST_A_CALL, DELIVERIES_A_CALL]);
  });

  it('N-T4 waiting: the delivery label in the reader language, the days as a number for the plural and as a string for the figure', () => {
    expect(observe(N_T4.en)).toEqual(
      said(
        `[delivery_waiting_on_client delivery=${DELIVERY_EN},dayCount=3,days=3]`,
        `translate#1 delivery_waiting_on_client {delivery: "${DELIVERY_EN}", dayCount: 3, days: "3"}`,
      ),
    );
    expect(observe(N_T4.ar)).toEqual(
      said(
        `[delivery_waiting_on_client delivery=${DELIVERY_AR},dayCount=3,days=3]`,
        `translate#1 delivery_waiting_on_client {delivery: "${DELIVERY_AR}", dayCount: 3, days: "3"}`,
      ),
    );
    const figures = [0, 1, 2, 12];
    expect(N_T4.days).toHaveLength(figures.length);
    for (const [i, days] of figures.entries()) {
      expect(observe(N_T4.days[i]).calls).toEqual([
        `translate#1 delivery_waiting_on_client {delivery: "${DELIVERY_EN}", dayCount: ${days}, days: "${days}"}`,
      ]);
    }
    // Days as a string: the string is shown, with the plural form for zero. Absent: 0 and "0".
    expect(observe(N_T4.stringDays).calls).toEqual([
      `translate#1 delivery_waiting_on_client {delivery: "${DELIVERY_EN}", dayCount: 0, days: "7"}`,
    ]);
    expect(observe(N_T4.noDays).calls).toEqual([
      `translate#1 delivery_waiting_on_client {delivery: "${DELIVERY_EN}", dayCount: 0, days: "0"}`,
    ]);
  });

  it('N-T5 details: names the actor by email with the name beside it, or says there is none', () => {
    expect(observe(N_T5.a)).toEqual(
      said(
        '[client_page_details_changed hasActor=yes,actor=Sara (sara@studio.test)]',
        'translate#1 client_page_details_changed {hasActor: "yes", actor: "Sara (sara@studio.test)"}',
      ),
    );
    expect(observe(N_T5.b)).toEqual(
      said(
        '[client_page_details_changed hasActor=yes,actor=Omar (omar@studio.test)]',
        'translate#1 client_page_details_changed {hasActor: "yes", actor: "Omar (omar@studio.test)"}',
      ),
    );
    // A name without an email is nobody: the email is the identity.
    expect(observe(N_T5.nameOnly).calls).toEqual(['translate#1 client_page_details_changed {hasActor: "no", actor: ""}']);
    expect(observe(N_T5.emailOnly).calls).toEqual(['translate#1 client_page_details_changed {hasActor: "yes", actor: "x@y.test"}']);
    expect(observe(N_T5.nameNotAString).calls).toEqual([
      'translate#1 client_page_details_changed {hasActor: "yes", actor: "five@studio.test"}',
    ]);
    expect(observe(N_T5.nobody)).toEqual(
      said('[client_page_details_changed hasActor=no,actor=]', 'translate#1 client_page_details_changed {hasActor: "no", actor: ""}'),
    );
  });

  it('N-T6 reminder: the two counts as strings, 0 when absent', () => {
    expect(observe(N_T6.a)).toEqual(said('[stage_reminder overdue=2,upcoming=6]', 'translate#1 stage_reminder {overdue: "2", upcoming: "6"}'));
    expect(observe(N_T6.b)).toEqual(said('[stage_reminder overdue=0,upcoming=1]', 'translate#1 stage_reminder {overdue: "0", upcoming: "1"}'));
    expect(observe(N_T6.none)).toEqual(said('[stage_reminder overdue=0,upcoming=0]', 'translate#1 stage_reminder {overdue: "0", upcoming: "0"}'));
  });
});

describe('notificationBody, keys that are not its own', () => {
  it('N-T7: an unknown key is an empty line and calls nothing', () => {
    expect(N_T7).toHaveLength(7);
    for (const one of N_T7) {
      expect([one.id, observe(one)]).toEqual([one.id, said('')]);
    }
  });

  it('N-T8: a client key is handed on with the locale and the milestone namer', () => {
    expect(observe(N_T8.en)).toEqual(
      said(
        `[client_payment_claimed delivery=${DELIVERY_EN},hasMilestone=yes,milestone=Deposit]`,
        'milestoneLabel "deposit"',
        `translate#1 client_payment_claimed {delivery: "${DELIVERY_EN}", hasMilestone: "yes", milestone: "Deposit"}`,
      ),
    );
    expect(observe(N_T8.ar)).toEqual(
      said(
        `[client_payment_claimed delivery=${DELIVERY_AR},hasMilestone=yes,milestone=Deposit]`,
        'milestoneLabel "deposit"',
        `translate#1 client_payment_claimed {delivery: "${DELIVERY_AR}", hasMilestone: "yes", milestone: "Deposit"}`,
      ),
    );
  });
});

describe('notificationBody, bad input', () => {
  it('N-T9: throws a TypeError for no item, and for no params under one of its own keys; nothing is called', () => {
    const throwing = [...N_T9.itemNull, ...N_T9.itemUndefined, ...N_T9.noParamsOwnKey];
    expect(throwing).toHaveLength(16);
    for (const one of throwing) {
      expect([one.id, outputOf(one)]).toEqual([one.id, 'THROWN TypeError\n']);
    }
  });

  it('N-T9: is an empty line for no params under an unknown key, and for no key', () => {
    for (const one of [...N_T9.noParamsUnknownKey, ...N_T9.noBodyKey]) {
      expect([one.id, observe(one)]).toEqual([one.id, said('')]);
    }
  });
});
