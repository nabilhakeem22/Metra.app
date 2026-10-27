import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeExecution } from '@/lib/client-home/types';
import type { ContractDocument } from '@/lib/contracts/public-types';
import { CONTRACT_ID, homePayload } from '@/test/client-home-payloads';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// H6.2 functional F1: what the section says after a signing is kept with the
// contract it was said about. The studio replaced the contract while the
// dialog was open: "this contract can no longer be signed here" must not stand
// under the NEW contract the refreshed page offers for signing. For the same
// contract (closed, terminated) it still stands.

vi.mock('server-only', () => ({}));
const actions = vi.hoisted(() => ({ signContractInHome: vi.fn(), openHomeContract: vi.fn(), loadHomeContractSections: vi.fn(), loadHomeContractSectionLines: vi.fn() }));
vi.mock('../contract-actions', () => actions);
const codeActions = vi.hoisted(() => ({ requestClientCode: vi.fn() }));
vi.mock('../code-actions', () => codeActions);

const { shapeHome } = await import('@/lib/client-home/shape');
const { ExecutionContract } = await import('./execution-contract');

const REPLACEMENT_ID = '00000000-0000-4000-8000-0000000000c2';
const STUDIO = { name: 'Noon Studio', whatsappDigits: '201000000002', deliveryRef: 'DE-2026-0012' };
const DOCUMENT = { id: CONTRACT_ID, source: 'boq', payment_schedule: [], section_count: 0, sections: [] } as unknown as ContractDocument;
const awaitingSignature = () => shapeHome(homePayload('sign_contract'))?.execution as HomeExecution;
const replaced = (execution: HomeExecution): HomeExecution => ({ ...execution, contract: execution.contract && { ...execution.contract, id: REPLACEMENT_ID } });

let readAgain: (execution: HomeExecution) => void = () => {};
function RefreshedCard() {
  const [execution, setExecution] = useState(awaitingSignature);
  readAgain = setExecution;
  const document = execution.contract?.id === REPLACEMENT_ID ? { ...DOCUMENT, id: REPLACEMENT_ID } : DOCUMENT;
  return (
    <ExecutionContract
      token="tok"
      execution={execution}
      firmName="Noon Studio"
      showsDesignRecord={false}
      signing={{ document, channel: { hint: 'c•••@e•••.com' }, studio: STUDIO, openOn: null, onChanged: () => undefined }}
    />
  );
}

beforeEach(() => {
  codeActions.requestClientCode.mockReset().mockResolvedValue({ ok: true, hint: 'c•••@e•••.com', resendAfterSeconds: 60 });
  actions.signContractInHome.mockReset().mockResolvedValue({ ok: false, error: 'contract_inactive' });
});

describe.each<TestLocale>(['en', 'ar-EG'])('the signing notice follows its contract (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, `delivery.contract.sign.${key}`);

  async function signAndGetMovedOn() {
    renderWithIntl(<RefreshedCard />, { locale });
    fireEvent.change(screen.getByLabelText(at('nameLabel')), { target: { value: 'Hesham' } });
    fireEvent.click(screen.getByRole('button', { name: at('button') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.code.haveCode') }));
    fireEvent.change(within(dialog).getByLabelText(messageAt(locale, 'delivery.code.label')), { target: { value: '042917' } });
    fireEvent.click(within(dialog).getByRole('button', { name: at('confirm') }));
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe(at('movedOn'));
  }

  it('a page read again with ANOTHER contract to sign drops the old sentence and offers the new signing', async () => {
    await signAndGetMovedOn();
    await act(async () => readAgain(replaced(awaitingSignature())));
    expect(screen.queryByText(at('movedOn'))).toBeNull();
    expect(document.getElementById(`sign-${REPLACEMENT_ID}`)).not.toBeNull();
  });

  it('a page read again with the SAME contract keeps the sentence', async () => {
    await signAndGetMovedOn();
    await act(async () => readAgain(awaitingSignature()));
    expect(screen.getByRole('alert').textContent).toBe(at('movedOn'));
  });
});
