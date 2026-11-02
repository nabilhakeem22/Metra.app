import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// H7.1: the home's change orders, read through /v's own document. The page holds
// no line and nothing the home does not show; a read that fails or stalls is null
// with one redacted line; the lines of an order the home no longer shows are null.

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { hashShareToken } from '@/lib/share/token';
import { homePayload } from '@/test/client-home-payloads';
import { OPTIONAL_READ_WAIT_MS } from './optional-read';
import { getOpenChangeOrderLines, homeShowsOpenChangeOrder, readOpenChangeOrders } from './variations';

const ORDER = '22222222-2222-4222-8222-222222222222';
const OTHER = '11111111-1111-4111-8111-111111111111';
const LINE = { id: 'l-1', description_ar: 'بند', description_en: 'Item', qty: '2.0000', unit: 'sqm', unit_price: '5000.0000', discount_pct: '0.0000', line_total: '10000.0000', sort_order: 2 };

const documentOf = (over: Record<string, unknown> = {}) => ({
  id: ORDER,
  number: 3,
  status: 'issued',
  title_ar: 'تعديل',
  title_en: 'Change',
  reason_ar: 'سبب',
  reason_en: 'Reason',
  net_delta: '10000.0000',
  currency: 'EGP',
  contract_number: 77,
  share_expires_at: '2099-01-01T00:00:00Z',
  contract_active: true,
  rejection_channel: null,
  tax_rate: '14.0000',
  supervision_pct: '10.0000',
  time_extension_days: 7,
  contract_source: 'boq',
  contract_end_date: '2027-02-28',
  time_extension_days_total: 0,
  org: { name_ar: 'نون', name_en: 'Noon', logo_file_id: null },
  lines: [LINE, { ...LINE, id: 'l-2', sort_order: 1 }],
  ...over,
});

let logged: string;

beforeEach(() => {
  sdf.readSdfJson.mockReset();
  logged = '';
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged += JSON.stringify(args);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('readOpenChangeOrders', () => {
  it('keeps the open list only, each order its figures and its line count: no line, studio, contract number or window', async () => {
    sdf.readSdfJson.mockResolvedValue({ open: [documentOf()], expired: [documentOf({ id: OTHER })], decided: [{ id: OTHER }] });
    const orders = await readOpenChangeOrders(' tok ');
    expect(orders).toEqual([
      {
        id: ORDER,
        number: 3,
        title_ar: 'تعديل',
        title_en: 'Change',
        reason_ar: 'سبب',
        reason_en: 'Reason',
        net_delta: '10000.0000',
        charges: { taxRate: '14.0000', supervisionPct: '10.0000' },
        timeExtensionDays: 7,
        finish: { endDate: '2027-02-28', approvedExtensionDays: 0 },
        total: '12400.0000',
        lineCount: 2,
      },
    ]);
    expect(JSON.stringify(sdf.readSdfJson.mock.calls[0][0])).toContain('app_home_variations_by_token');
    expect((sdf.readSdfJson.mock.calls[0][0] as { queryChunks: unknown[] }).queryChunks).toContain(hashShareToken('tok'));
  });

  it('an order with no rates: its total is its net change', async () => {
    sdf.readSdfJson.mockResolvedValue({ open: [documentOf({ tax_rate: undefined })], expired: [], decided: [] });
    expect((await readOpenChangeOrders('tok'))?.[0]).toMatchObject({ charges: null, total: '10000.0000' });
  });

  it('a blank token reads nothing; a link that shows none, or an answer of another shape, is null', async () => {
    expect(await readOpenChangeOrders('  ')).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
    sdf.readSdfJson.mockResolvedValue(null);
    expect(await readOpenChangeOrders('tok')).toBeNull();
    sdf.readSdfJson.mockResolvedValue({ open: 'x' });
    expect(await readOpenChangeOrders('tok')).toBeNull();
    expect(logged).toBe('');
  });

  it('a failed read: null, ONE redacted line, no token or hash', async () => {
    sdf.readSdfJson.mockRejectedValue(Object.assign(new Error(`Failed query: select params: ${hashShareToken('tok')}`), { query: 'select', params: [hashShareToken('tok')] }));
    expect(await readOpenChangeOrders('tok')).toBeNull();
    expect(logged).toContain('client home change orders read failed');
    expect(logged).not.toContain(hashShareToken('tok'));
  });

  it('a document this build cannot read: null, one line, never a thrown page', async () => {
    sdf.readSdfJson.mockResolvedValue({ open: [null] });
    expect(await readOpenChangeOrders('tok')).toBeNull();
    expect(logged).toContain('client home change orders read failed');
  });

  it('a stalled read: null at the wait, one line', async () => {
    vi.useFakeTimers();
    sdf.readSdfJson.mockReturnValue(new Promise(() => {}));
    const answer = readOpenChangeOrders('tok');
    await vi.advanceTimersByTimeAsync(OPTIONAL_READ_WAIT_MS - 1);
    expect(logged).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toBeNull();
    expect(logged).toContain('client home change orders read failed');
  });
});

describe('getOpenChangeOrderLines', () => {
  const answerWith = (...open: unknown[]) => sdf.readSdfJson.mockResolvedValue({ open, expired: [], decided: [] });

  it('the order lines by their order, as contract lines: no item code, not provisional; the id compared lower case', async () => {
    answerWith(documentOf());
    const lines = await getOpenChangeOrderLines('tok', ORDER.toUpperCase());
    expect(lines?.map((line) => line.id)).toEqual(['l-2', 'l-1']);
    expect(lines?.[0]).toMatchObject({ item_code: null, provisional: false, line_total: '10000.0000' });
  });

  it('an order the list does not hold, or a link that shows none: null', async () => {
    answerWith(documentOf());
    expect(await getOpenChangeOrderLines('tok', OTHER)).toBeNull();
    sdf.readSdfJson.mockResolvedValue(null);
    expect(await getOpenChangeOrderLines('tok', ORDER)).toBeNull();
  });

  it.each(['nope', '', null, 7, {}])('a non-uuid id (%j): null with no round trip', async (id) => {
    expect(await getOpenChangeOrderLines('tok', id)).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });
});

describe('homeShowsOpenChangeOrder', () => {
  const ON_THE_HOME_CONTRACT = { id: ORDER, contract_number: 4 };
  /** The home's payload counting `open` change orders the client can decide. */
  const homeCounting = (open: number) => {
    const home = homePayload('decide_change_order') as { execution: { flow_source: { contract: { money: Record<string, unknown> } } } };
    home.execution.flow_source.contract.money = { ...home.execution.flow_source.contract.money, open_variations: open, issued_variations: open };
    return home;
  };

  it('counted, on the contract the home stands on: true on the home read alone', async () => {
    sdf.readSdfJson.mockResolvedValueOnce(homeCounting(10));
    expect(await homeShowsOpenChangeOrder('tok', ON_THE_HOME_CONTRACT)).toBe(true);
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sdf.readSdfJson.mock.calls[0][0])).toContain('app_home_by_token');
  });

  it('an order of another contract of the delivery: false', async () => {
    sdf.readSdfJson.mockResolvedValueOnce(homeCounting(1));
    expect(await homeShowsOpenChangeOrder('tok', { id: ORDER, contract_number: 5 })).toBe(false);
  });

  it('a contract awaiting its signature: the home counts none, so its page lists none', async () => {
    sdf.readSdfJson.mockResolvedValueOnce(homePayload('sign_contract'));
    expect(await homeShowsOpenChangeOrder('tok', ON_THE_HOME_CONTRACT)).toBe(false);
  });

  it('past the cap of the list, only the list can say', async () => {
    sdf.readSdfJson.mockResolvedValueOnce(homeCounting(11)).mockResolvedValueOnce({ open: [documentOf()], expired: [], decided: [] });
    expect(await homeShowsOpenChangeOrder('tok', ON_THE_HOME_CONTRACT)).toBe(true);
    sdf.readSdfJson.mockResolvedValueOnce(homeCounting(11)).mockResolvedValueOnce({ open: [documentOf({ id: OTHER })], expired: [], decided: [] });
    expect(await homeShowsOpenChangeOrder('tok', ON_THE_HOME_CONTRACT)).toBe(false);
  });

  it('a failed home read is false, logged by its reader; a failed list read throws for the caller to decide', async () => {
    sdf.readSdfJson.mockRejectedValueOnce(new Error('down'));
    expect(await homeShowsOpenChangeOrder('tok', ON_THE_HOME_CONTRACT)).toBe(false);
    expect(logged).toContain('client home read failed');
    sdf.readSdfJson.mockResolvedValueOnce(homeCounting(11)).mockRejectedValueOnce(new Error('down'));
    await expect(homeShowsOpenChangeOrder('tok', ON_THE_HOME_CONTRACT)).rejects.toThrow('down');
  });
});
