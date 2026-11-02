import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatMoneyExact } from '@/lib/format/money';
import { messageAt, type TestLocale } from '@/test/render-with-intl';

// H7.1 (AC4 to AC7): the client decides a change order in the home. Its figures
// on the card; a name inline; [Approve] or [Reject] opens the dialog with the
// one-time code; Confirm waits for six digits and decides once. What the answers
// do: change-order-answers.test.tsx.

vi.mock('server-only', () => ({}));
const actions = vi.hoisted(() => ({ decideVariationInHome: vi.fn(), loadChangeOrderLines: vi.fn() }));
vi.mock('@/app/[locale]/d/[token]/variation-actions', () => actions);
const codeActions = vi.hoisted(() => ({ requestClientCode: vi.fn() }));
vi.mock('@/app/[locale]/d/[token]/code-actions', () => codeActions);

const { A, B, HINT, STUDIO, orderOf, sectionDriver } = await import('@/test/change-order-section');

const onChanged = vi.fn();

beforeEach(() => {
  for (const mock of [actions.decideVariationInHome, codeActions.requestClientCode, onChanged]) mock.mockReset();
  codeActions.requestClientCode.mockResolvedValue({ ok: true, hint: HINT, resendAfterSeconds: 60 });
  actions.decideVariationInHome.mockResolvedValue({ ok: true, already: false });
});

describe.each<TestLocale>(['en', 'ar-EG'])('deciding a change order in the home (%s)', (locale) => {
  const { at, words, mount, card, nameBox, press, dialog, confirmButton, codeBox, openWithCode } = sectionDriver(locale, actions.decideVariationInHome, onChanged);

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
