import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeExecution } from '@/lib/client-home/types';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { CONTRACT_ID, homePayload } from '@/test/client-home-payloads';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// H6.2: the client signs the execution contract in the home. The name box is
// inline (as on /c); [Sign] with no name marks it and sends nothing; with a
// name it opens the dialog with the one-time code panel, Confirm waits for six
// digits and signs once. A code refusal stays in the dialog; every other
// answer closes it and is said in the section, where it still stands after
// the page is read again. No address on file: the studio's WhatsApp, nothing
// to sign with.

vi.mock('server-only', () => ({}));
const actions = vi.hoisted(() => ({
  signContractInHome: vi.fn(),
  openHomeContract: vi.fn(),
  loadHomeContractSections: vi.fn(),
  loadHomeContractSectionLines: vi.fn(),
}));
vi.mock('../contract-actions', () => actions);
const codeActions = vi.hoisted(() => ({ requestClientCode: vi.fn() }));
vi.mock('../code-actions', () => codeActions);

const { shapeHome } = await import('@/lib/client-home/shape');
const { ExecutionContract } = await import('./execution-contract');

const HINT = 'c•••@e•••.com';
const STUDIO = { name: 'Noon Studio', whatsappDigits: '201000000002', deliveryRef: 'DE-2026-0012' };
const DOCUMENT = {
  id: CONTRACT_ID,
  source: 'boq',
  original_value: '100000.0000',
  total: '114000.0000',
  payment_schedule: [],
  section_count: 0,
  sections: [],
} as unknown as ContractDocument;

const executionAt = (reason: 'sign_contract' | 'signing_closed' | 'works_in_progress') =>
  shapeHome(homePayload(reason))?.execution as HomeExecution;

const onChanged = vi.fn();

function card(
  execution: HomeExecution,
  { channel = { hint: HINT }, openOn = null }: { channel?: { hint: string } | null; openOn?: string | null } = {},
) {
  return (
    <ExecutionContract
      token="tok"
      execution={execution}
      firmName="Noon Studio"
      showsDesignRecord={false}
      signing={{ document: DOCUMENT, channel, studio: STUDIO, openOn, onChanged }}
    />
  );
}

/** The card as the page hands it down; `readAgain` is the page read again in another state (a refresh). */
let readAgain: (execution: HomeExecution) => void = () => {};
function RefreshedCard({ initial }: { initial: HomeExecution }) {
  const [execution, setExecution] = useState(initial);
  readAgain = setExecution;
  return card(execution);
}

beforeEach(() => {
  for (const mock of [actions.signContractInHome, actions.openHomeContract, codeActions.requestClientCode, onChanged]) mock.mockReset();
  codeActions.requestClientCode.mockResolvedValue({ ok: true, hint: HINT, resendAfterSeconds: 60 });
  actions.signContractInHome.mockResolvedValue({ ok: true, already: false });
});

describe.each<TestLocale>(['en', 'ar-EG'])('signing the contract in the home (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, `delivery.contract.sign.${key}`);
  const nameBox = () => screen.getByLabelText(at('nameLabel')) as HTMLInputElement;
  const signButton = () => screen.getByRole('button', { name: at('button') });
  const dialog = () => screen.findByRole('dialog');
  const confirmButton = async () => within(await dialog()).getByRole('button', { name: at('confirm') }) as HTMLButtonElement;
  const codeBox = async () => within(await dialog()).getByLabelText(messageAt(locale, 'delivery.code.label')) as HTMLInputElement;

  async function openWithCode(name = 'Hesham Adel', code = '042917') {
    fireEvent.change(nameBox(), { target: { value: name } });
    fireEvent.click(signButton());
    fireEvent.click(within(await dialog()).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }));
    await act(async () => {});
    fireEvent.change(await codeBox(), { target: { value: code } });
  }

  async function signWith(answer: unknown) {
    actions.signContractInHome.mockResolvedValueOnce(answer);
    await openWithCode();
    fireEvent.click(await confirmButton());
    await act(async () => {});
  }

  it('a blank or spaces-only name marks the box, moves the caret there and sends nothing (AC3)', () => {
    renderWithIntl(card(executionAt('sign_contract')), { locale });
    for (const name of ['', '   ']) {
      fireEvent.change(nameBox(), { target: { value: name } });
      fireEvent.click(signButton());
      expect(document.activeElement).toBe(nameBox());
      expect(nameBox().getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText(at('nameRequired'))).toBeTruthy();
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
    expect(actions.signContractInHome).not.toHaveBeenCalled();
  });

  it('with a name: the dialog names the contract and the name; Confirm waits for six digits, then signs ONCE (AC4)', async () => {
    renderWithIntl(card(executionAt('sign_contract')), { locale });
    fireEvent.change(nameBox(), { target: { value: '  Hesham   Adel ' } });
    fireEvent.click(signButton());
    const shown = await dialog();
    expect(shown.textContent).toContain('C-2026-0004');
    expect(shown.textContent).toContain('Hesham Adel');
    expect((await confirmButton()).disabled).toBe(true);
    fireEvent.click(within(shown).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }));
    await act(async () => {});
    expect(codeActions.requestClientCode).toHaveBeenCalledWith('tok', { purpose: 'sign_contract', target: CONTRACT_ID });
    fireEvent.change(await codeBox(), { target: { value: '04291' } });
    expect((await confirmButton()).disabled).toBe(true);
    fireEvent.change(await codeBox(), { target: { value: '042917' } });
    const confirm = await confirmButton();
    expect(confirm.disabled).toBe(false);
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(actions.signContractInHome).toHaveBeenCalledTimes(1);
    expect(actions.signContractInHome).toHaveBeenCalledWith('tok', { contractId: CONTRACT_ID, name: 'Hesham Adel', code: '042917' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(at('signed').replace('{studio}', 'Noon Studio'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('signed on paper meanwhile: already signed, said in the section, the page read again', async () => {
    renderWithIntl(card(executionAt('sign_contract')), { locale });
    await signWith({ ok: true, already: true });
    expect(screen.getByRole('status').textContent).toBe(at('already'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('the window closed: the dialog closes, the section says so and keeps saying it once the page shows signing_closed (AC5)', async () => {
    renderWithIntl(<RefreshedCard initial={executionAt('sign_contract')} />, { locale });
    await signWith({ ok: false, error: 'signing_closed' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const said = at('signingClosed').replace('{studio}', 'Noon Studio');
    expect(screen.getByRole('alert').textContent).toBe(said);
    expect(onChanged).toHaveBeenCalledTimes(1);
    await act(async () => readAgain(executionAt('signing_closed')));
    expect(screen.getByRole('alert').textContent).toBe(said);
    expect(document.querySelector('[data-sign-panel]')).toBeNull();
    expect(document.getElementById('contract')?.textContent).not.toContain(messageAt(locale, 'delivery.contract.signingClosed').replace('{studio}', 'Noon Studio'));
  });

  it('a code refusal keeps the dialog open with the panel sentence; busy keeps the typed code (AC6)', async () => {
    renderWithIntl(card(executionAt('sign_contract')), { locale });
    await signWith({ ok: false, error: 'code_wrong', attemptsLeft: 3 });
    expect(await dialog()).toBeTruthy();
    expect(within(await dialog()).getByRole('alert').textContent).toMatch(locale === 'en' ? /\b3\b/ : /3/);
    actions.signContractInHome.mockResolvedValueOnce({ ok: false, error: 'busy' });
    fireEvent.change(await codeBox(), { target: { value: '111111' } });
    fireEvent.click(await confirmButton());
    await act(async () => {});
    expect(within(await dialog()).getByRole('alert').textContent).toBe(messageAt(locale, 'delivery.code.error.busy'));
    expect((await codeBox()).value).toBe('111111');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it.each(['wrong_target', 'contract_inactive'])('%s: the dialog closes, the contract moved on, the page read again (AC7)', async (error) => {
    renderWithIntl(card(executionAt('sign_contract')), { locale });
    await signWith({ ok: false, error });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(at('movedOn'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a code asked for a contract no longer open to signing closes the dialog: moved on, read again (AC7)', async () => {
    codeActions.requestClientCode.mockResolvedValueOnce({ ok: false, error: 'not_available' });
    renderWithIntl(card(executionAt('sign_contract')), { locale });
    fireEvent.change(nameBox(), { target: { value: 'Hesham' } });
    fireEvent.click(signButton());
    fireEvent.click(within(await dialog()).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(at('movedOn'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('an answer that never came: the shared uncertain sentence, the page read again, the button free again (AC7)', async () => {
    renderWithIntl(card(executionAt('sign_contract')), { locale });
    actions.signContractInHome.mockRejectedValueOnce(new Error('network'));
    await openWithCode();
    fireEvent.click(await confirmButton());
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.errors.uncertain'));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect((signButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('a dead link or a failure with a reference is said as every link page says it, with no refresh', async () => {
    renderWithIntl(card(executionAt('sign_contract')), { locale });
    await signWith({ ok: false, error: 'token_expired' });
    expect(screen.getByRole('alert').textContent).toBe(messageAt(locale, 'portal.errors.token_expired'));
    expect(onChanged).not.toHaveBeenCalled();
    expect(signButton()).toBeTruthy();
  });

  it('no address on file: the studio has no email sentence and its WhatsApp, no name box, no sign button (AC8)', () => {
    const { container } = renderWithIntl(card(executionAt('sign_contract'), { channel: null }), { locale });
    const panel = container.querySelector(`#sign-${CONTRACT_ID}`) as HTMLElement;
    expect(within(panel).getByRole('status').textContent).toBe(
      messageAt(locale, 'delivery.code.noChannel.signature').replaceAll('{studio}', 'Noon Studio'),
    );
    expect(within(panel).getByRole('link').getAttribute('href')).toMatch(/^https:\/\/wa\.me\/201000000002\?text=/);
    expect(screen.queryByLabelText(at('nameLabel'))).toBeNull();
    expect(screen.queryByRole('button', { name: at('button') })).toBeNull();
  });

  it('a code email link: the signing opens on the code box, no new code asked for (AC9)', async () => {
    renderWithIntl(card(executionAt('sign_contract'), { openOn: CONTRACT_ID }), { locale });
    fireEvent.change(nameBox(), { target: { value: 'Hesham' } });
    fireEvent.click(signButton());
    expect(await codeBox()).toBeTruthy();
    expect(codeActions.requestClientCode).not.toHaveBeenCalled();
  });
});
