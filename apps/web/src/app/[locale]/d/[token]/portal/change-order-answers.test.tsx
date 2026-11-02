import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messageAt, type TestLocale } from '@/test/render-with-intl';

// H7.1 (AC8 to AC11): what a decision's answer does. A code refusal stays in the
// dialog; every other answer closes it and is said at the top of the section,
// where it still stands after the page is read again.

vi.mock('server-only', () => ({}));
const actions = vi.hoisted(() => ({ decideVariationInHome: vi.fn(), loadChangeOrderLines: vi.fn() }));
vi.mock('@/app/[locale]/d/[token]/variation-actions', () => actions);
const codeActions = vi.hoisted(() => ({ requestClientCode: vi.fn() }));
vi.mock('@/app/[locale]/d/[token]/code-actions', () => codeActions);

const driver = await import('@/test/change-order-section');
const { A, B, HINT, orderOf, sectionDriver } = driver;

const onChanged = vi.fn();

beforeEach(() => {
  for (const mock of [actions.decideVariationInHome, codeActions.requestClientCode, onChanged]) mock.mockReset();
  codeActions.requestClientCode.mockResolvedValue({ ok: true, hint: HINT, resendAfterSeconds: 60 });
  actions.decideVariationInHome.mockResolvedValue({ ok: true, already: false });
});

describe.each<TestLocale>(['en', 'ar-EG'])('the answers to a decision (%s)', (locale) => {
  const { at, words, mount, card, nameBox, press, dialog, confirmButton, codeBox, openWithCode, decideWith } = sectionDriver(locale, actions.decideVariationInHome, onChanged);

  it.each<['approve' | 'reject', string]>([['approve', 'approved'], ['reject', 'rejected']])('%s answered ok: the notice, the page read again; with none open the section holds the notice alone (AC8)', async (key, notice) => {
    mount();
    await decideWith({ ok: true, already: false }, key);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(words(`decide.${notice}`, 3));
    expect(onChanged).toHaveBeenCalledTimes(1);
    await act(async () => driver.readAgain(null, 0));
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

  it('a rejected promise on an offline phone: the same sentence, and the page stays (F6)', async () => {
    const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount();
    actions.decideVariationInHome.mockRejectedValueOnce(new Error('lost'));
    await openWithCode();
    fireEvent.click(await confirmButton());
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.errors.uncertain'));
    expect(onChanged).not.toHaveBeenCalled();
    offline.mockRestore();
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
    await act(async () => driver.readAgain([orderOf(B, 4)], 1));
    const notice = screen.getByRole('status');
    expect(notice.textContent).toBe(words('decide.approved', 3));
    expect(document.getElementById(`variation-${B}`)?.contains(notice)).toBe(false);
    await openWithCode('reject', '111222', B);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(await confirmButton('reject'));
    await act(async () => {});
    expect(actions.decideVariationInHome).toHaveBeenLastCalledWith('tok', { variationId: B, decision: 'reject', name: 'Hesham Adel', code: '111222' });
  });
});
