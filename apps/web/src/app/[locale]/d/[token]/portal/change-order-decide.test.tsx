import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeChangeOrder } from '@/lib/client-home/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatMoneyExact } from '@/lib/format/money';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// H7.1 (AC4 to AC11): the client decides a change order in the home. Its figures
// on the card; a name inline; [Approve] or [Reject] opens the dialog with the
// one-time code; Confirm waits for six digits and decides once. A code refusal
// stays in the dialog; every other answer closes it and is said at the top of the
// section, where it still stands after the page is read again.

vi.mock('server-only', () => ({}));
const actions = vi.hoisted(() => ({ decideVariationInHome: vi.fn(), loadChangeOrderLines: vi.fn() }));
vi.mock('../variation-actions', () => actions);
const codeActions = vi.hoisted(() => ({ requestClientCode: vi.fn() }));
vi.mock('../code-actions', () => codeActions);

const { ExecutionChangeOrders } = await import('./execution-change-orders');

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const HINT = 'c•••@e•••.com';
const STUDIO = { name: 'Noon Studio', whatsappDigits: '201000000002', deliveryRef: 'DE-2026-0012' };
const onChanged = vi.fn();

const orderOf = (id: string, number: number, over: Partial<HomeChangeOrder> = {}): HomeChangeOrder => ({
  id,
  number,
  title_ar: 'تعديل الأرضيات',
  title_en: 'Flooring change',
  reason_ar: 'طلب العميل',
  reason_en: 'Client request',
  net_delta: '10000.0000',
  charges: { taxRate: '14.0000', supervisionPct: '10.0000' },
  timeExtensionDays: 7,
  finish: { endDate: '2027-02-28', approvedExtensionDays: 5 },
  total: '12400.0000',
  lineCount: 2,
  ...over,
});

let readAgain: (orders: HomeChangeOrder[] | null, openCount: number) => void = () => {};

function Section({ orders, openCount, channel, openOn }: { orders: HomeChangeOrder[] | null; openCount: number; channel: { hint: string } | null; openOn: string | null }) {
  const [page, setPage] = useState({ orders, openCount });
  readAgain = (next, count) => setPage({ orders: next, openCount: count });
  return <ExecutionChangeOrders token="tok" orders={page.orders} openCount={page.openCount} channel={channel} studio={STUDIO} openOn={openOn} onChanged={onChanged} />;
}

beforeEach(() => {
  for (const mock of [actions.decideVariationInHome, codeActions.requestClientCode, onChanged]) mock.mockReset();
  codeActions.requestClientCode.mockResolvedValue({ ok: true, hint: HINT, resendAfterSeconds: 60 });
  actions.decideVariationInHome.mockResolvedValue({ ok: true, already: false });
});

describe.each<TestLocale>(['en', 'ar-EG'])('deciding a change order in the home (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, `delivery.changeOrders.${key}`);
  const words = (key: string, number: number) => at(key).replaceAll('{number}', bidiIsolate(String(number))).replaceAll('{studio}', STUDIO.name);
  const mount = (over: { orders?: HomeChangeOrder[] | null; openCount?: number; channel?: { hint: string } | null; openOn?: string | null } = {}) => {
    const orders = over.orders === undefined ? [orderOf(A, 3)] : over.orders;
    const channel = over.channel === undefined ? { hint: HINT } : over.channel;
    return renderWithIntl(<Section orders={orders} openCount={over.openCount ?? orders?.length ?? 0} channel={channel} openOn={over.openOn ?? null} />, { locale });
  };
  const card = (id = A) => within(document.getElementById(`variation-${id}`) as HTMLElement);
  const nameBox = (id = A) => card(id).getByLabelText(at('decide.nameLabel')) as HTMLInputElement;
  const press = (key: 'approve' | 'reject', id = A) => fireEvent.click(card(id).getByRole('button', { name: at(`decide.${key}`) }));
  const dialog = () => screen.findByRole('dialog');
  const confirmButton = async (key: 'approve' | 'reject' = 'approve') => within(await dialog()).getByRole('button', { name: at(`decide.confirm.${key}`) }) as HTMLButtonElement;
  const codeBox = async () => within(await dialog()).getByLabelText(messageAt(locale, 'delivery.code.label')) as HTMLInputElement;

  async function openWithCode(key: 'approve' | 'reject' = 'approve', code = '042917', id = A) {
    fireEvent.change(nameBox(id), { target: { value: 'Hesham Adel' } });
    press(key, id);
    fireEvent.click(within(await dialog()).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }));
    await act(async () => {});
    fireEvent.change(await codeBox(), { target: { value: code } });
  }

  async function decideWith(answer: unknown, key: 'approve' | 'reject' = 'approve') {
    actions.decideVariationInHome.mockResolvedValueOnce(answer);
    await openWithCode(key);
    fireEvent.click(await confirmButton(key));
    await act(async () => {});
  }

  it('each order: its card with number, title, reason, works, VAT, supervision, total, the days it would add and the revised finish (AC4)', () => {
    mount({ orders: [orderOf(A, 3), orderOf(B, 4)] });
    const text = document.getElementById(`variation-${A}`)?.textContent ?? '';
    expect(text).toContain(locale === 'en' ? 'Flooring change' : 'تعديل الأرضيات');
    expect(text).toContain(locale === 'en' ? 'Client request' : 'طلب العميل');
    for (const key of ['works', 'tax', 'supervision', 'total']) expect(text).toContain(messageAt(locale, `portal.changeOrder.charge.${key}`));
    expect(text).toContain(formatMoneyExact('12400.0000', locale));
    expect(text).toContain(locale === 'en' ? 'Would add 7 days' : '7');
    expect(text).toContain(locale === 'en' ? 'Revised completion date' : 'تاريخ الانتهاء المعدَّل');
    expect(document.getElementById(`variation-${B}`)).not.toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: words('number', 3) })).toBeTruthy();
  });

  it.each(['approve', 'reject'] as const)('[%s] with a blank or spaces-only name marks the box and sends nothing (AC5)', (key) => {
    mount();
    for (const name of ['', '   ']) {
      fireEvent.change(nameBox(), { target: { value: name } });
      press(key);
      expect(document.activeElement).toBe(nameBox());
      expect(nameBox().getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText(at('decide.nameRequired'))).toBeTruthy();
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
    expect(actions.decideVariationInHome).not.toHaveBeenCalled();
  });

  it('with a name: the dialog follows the decision and names the total and the name; Confirm waits for six digits, then decides ONCE (AC6)', async () => {
    mount();
    fireEvent.change(nameBox(), { target: { value: '  Hesham   Adel ' } });
    press('approve');
    const shown = await dialog();
    expect(within(shown).getByRole('heading').textContent).toBe(words('decide.confirmTitle.approve', 3));
    expect(shown.textContent).toContain(bidiIsolate(formatMoneyExact('12400.0000', locale)));
    expect(shown.textContent).toContain(bidiIsolate('Hesham Adel'));
    expect((await confirmButton()).disabled).toBe(true);
    fireEvent.click(within(shown).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }));
    await act(async () => {});
    expect(codeActions.requestClientCode).toHaveBeenCalledWith('tok', { purpose: 'decide_variation', target: A });
    fireEvent.change(await codeBox(), { target: { value: '04291' } });
    expect((await confirmButton()).disabled).toBe(true);
    fireEvent.change(await codeBox(), { target: { value: '042917' } });
    const confirm = await confirmButton();
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(actions.decideVariationInHome).toHaveBeenCalledTimes(1);
    expect(actions.decideVariationInHome).toHaveBeenCalledWith('tok', { variationId: A, decision: 'approve', name: 'Hesham Adel', code: '042917' });
  });

  it('cancelling Approve then pressing Reject keeps the code box and the typed code; the dialog now says Reject (AC7)', async () => {
    mount();
    await openWithCode('approve');
    fireEvent.click(within(await dialog()).getByRole('button', { name: messageAt(locale, 'delivery.actions.cancel') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    press('reject');
    expect((await codeBox()).value).toBe('042917');
    expect(within(await dialog()).getByRole('heading').textContent).toBe(words('decide.confirmTitle.reject', 3));
    fireEvent.click(await confirmButton('reject'));
    await act(async () => {});
    expect(actions.decideVariationInHome).toHaveBeenCalledWith('tok', { variationId: A, decision: 'reject', name: 'Hesham Adel', code: '042917' });
    expect(codeActions.requestClientCode).toHaveBeenCalledTimes(1);
  });

  it.each<['approve' | 'reject', string]>([['approve', 'approved'], ['reject', 'rejected']])('%s answered ok: the notice, the page read again; with none open the section holds the notice alone (AC8)', async (key, notice) => {
    mount();
    await decideWith({ ok: true, already: false }, key);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(words(`decide.${notice}`, 3));
    expect(onChanged).toHaveBeenCalledTimes(1);
    await act(async () => readAgain(null, 0));
    const section = document.getElementById('change-orders') as HTMLElement;
    expect(section.textContent).toBe(words(`decide.${notice}`, 3));
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it.each<[string, unknown]>([['already', { ok: true, already: true }], ['code_used', { ok: false, error: 'code_used' }]])('%s reads as already decided: the dialog closes, the page read again (AC9)', async (_case, answer) => {
    mount();
    await decideWith(answer);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(words('decide.already', 3));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it.each<[string, unknown, string]>([
    ['code_wrong', { ok: false, error: 'code_wrong', attemptsLeft: 3 }, ''],
    ['code_locked', { ok: false, error: 'code_locked' }, 'delivery.code.error.code_locked'],
    ['code_expired', { ok: false, error: 'code_expired' }, 'delivery.code.error.code_expired'],
    ['code_unknown', { ok: false, error: 'code_unknown' }, 'delivery.code.error.code_unknown'],
    ['busy', { ok: false, error: 'busy' }, 'delivery.code.error.busy'],
  ])('%s stays in the dialog, said in the panel, the page not read again (AC9)', async (error, answer, key) => {
    mount();
    await decideWith(answer);
    const shown = await dialog();
    if (key) expect(within(shown).getByRole('alert').textContent).toBe(messageAt(locale, key));
    else expect(within(shown).getByRole('alert')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    if (error === 'busy') expect((await codeBox()).value).toBe('042917');
  });

  it('too many: stays in the dialog with the link minute sentence, Confirm held (AC9)', async () => {
    mount();
    await decideWith({ ok: false, error: 'too_many', retryAfterSeconds: 60, limit: 'link_minute' });
    expect(within(await dialog()).getByRole('alert')).toBeTruthy();
    expect((await confirmButton()).disabled).toBe(true);
  });

  it.each<[string, unknown, string, 'alert']>([
    ['link_expired', { ok: false, error: 'link_expired' }, 'decide.replyClosed', 'alert'],
    ['wrong_target', { ok: false, error: 'wrong_target' }, 'decide.movedOn', 'alert'],
    ['contract_inactive', { ok: false, error: 'contract_inactive' }, 'decide.movedOn', 'alert'],
  ])('%s closes the dialog, says so at the section, reads the page again (AC10)', async (_case, answer, key) => {
    mount();
    await decideWith(answer);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(words(key, 3));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a code request answering not_available: moved on, the page read again (AC10)', async () => {
    codeActions.requestClientCode.mockResolvedValue({ ok: false, error: 'not_available' });
    mount();
    fireEvent.change(nameBox(), { target: { value: 'Hesham' } });
    press('approve');
    fireEvent.click(within(await dialog()).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(words('decide.movedOn', 3));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a rejected promise: uncertain, the page read again, the spinner gone (AC10)', async () => {
    mount();
    actions.decideVariationInHome.mockRejectedValueOnce(new Error('lost'));
    await openWithCode();
    fireEvent.click(await confirmButton());
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.errors.uncertain'));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(card().getByRole<HTMLButtonElement>('button', { name: at('decide.approve') }).disabled).toBe(false);
  });

  it('a dead link: its portal sentence, and the page is not read again', async () => {
    mount();
    await decideWith({ ok: false, error: 'token_expired' });
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.errors.token_expired'));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('a notice about A stands at the section, never inside B; when the list no longer holds A it still shows; B stays decidable (AC11)', async () => {
    mount({ orders: [orderOf(A, 3), orderOf(B, 4)] });
    await decideWith({ ok: true, already: false });
    await act(async () => readAgain([orderOf(B, 4)], 1));
    const notice = screen.getByRole('status');
    expect(notice.textContent).toBe(words('decide.approved', 3));
    expect(document.getElementById(`variation-${B}`)?.contains(notice)).toBe(false);
    await openWithCode('reject', '111222', B);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(await confirmButton('reject'));
    await act(async () => {});
    expect(actions.decideVariationInHome).toHaveBeenLastCalledWith('tok', { variationId: B, decision: 'reject', name: 'Hesham Adel', code: '111222' });
  });

  it('a read that failed: the sentence and no decision offered; more open than shown: the note (AC3)', () => {
    const failed = mount({ orders: null, openCount: 2 });
    expect(screen.getByText(at('unavailable'))).toBeTruthy();
    expect(document.querySelector('[data-decide-panel]')).toBeNull();
    failed.unmount();
    mount({ orders: [orderOf(A, 3)], openCount: 11 });
    expect(screen.getByText(at('moreThanShown').replace('{shown}', '1').replace('{count}', '11'))).toBeTruthy();
  });

  it('no address on file: the panel sentence with the WhatsApp, no name box, no buttons', () => {
    mount({ channel: null });
    const text = document.getElementById(`variation-${A}`)?.textContent ?? '';
    expect(text).toContain(messageAt(locale, 'delivery.code.noChannel.decision').replaceAll('{studio}', STUDIO.name));
    expect(card().queryByLabelText(at('decide.nameLabel'))).toBeNull();
    expect(card().queryByRole('button', { name: at('decide.approve') })).toBeNull();
    expect(card().getByRole('link').getAttribute('href')).toContain('wa.me');
  });

  it("a code email's link: the first press with a name opens on the code box of THAT order alone, and nothing is sent", async () => {
    mount({ orders: [orderOf(A, 3), orderOf(B, 4)], openOn: B });
    fireEvent.change(nameBox(B), { target: { value: 'Hesham' } });
    press('approve', B);
    expect(await codeBox()).toBeTruthy();
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
    fireEvent.click(within(await dialog()).getByRole('button', { name: messageAt(locale, 'delivery.actions.cancel') }));
    fireEvent.change(nameBox(A), { target: { value: 'Hesham' } });
    press('approve', A);
    expect(within(await dialog()).queryByLabelText(messageAt(locale, 'delivery.code.label'))).toBeNull();
  });

  it('nothing open and nothing said: no section at all', () => {
    mount({ orders: null, openCount: 0 });
    expect(document.getElementById('change-orders')).toBeNull();
  });
});
