import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { HomeExecution } from '@/lib/client-home/types';
import type { PublicContract, PublicContractLine } from '@/lib/contracts/public-types';
import { homePayload } from '@/test/client-home-payloads';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// H6.2, the read: the Execution tab's contract opens in full on the client's
// tap, and shows EXACTLY what /c shows for the same contract, through the same
// components (AC2's parity, which H3 proved on the SQL, here on the page). The
// tab's render reads nothing for it: opening is one read, each collapsed
// section's lines one more, and hiding and showing again none.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/client', () => ({ withRequestDb: vi.fn() }));
const home = vi.hoisted(() => ({ open: vi.fn(), sections: vi.fn(), lines: vi.fn() }));
vi.mock('../contract-actions', () => ({
  openHomeContract: home.open,
  loadHomeContractSections: home.sections,
  loadHomeContractSectionLines: home.lines,
}));
const link = vi.hoisted(() => ({ sections: vi.fn(), lines: vi.fn() }));
vi.mock('@/app/[locale]/c/[token]/actions', () => ({
  acknowledgeContract: vi.fn(),
  loadContractSections: link.sections,
  loadContractSectionLines: link.lines,
}));

const { contractDocumentOf } = await import('@/lib/client-home/contract');
const { PublicContractView } = await import('@/app/[locale]/c/[token]/public-contract');
const { ContractDocumentDisclosure } = await import('./contract-document');
const { ExecutionContract } = await import('./execution-contract');
const { shapeHome } = await import('@/lib/client-home/shape');

const CONTRACT_ID = '0b6f8e0c-2c1d-4c55-9c1a-6a1c8f0d0001';

const line = (n: number, unit: string, qty: string): PublicContractLine => ({
  id: `l-${String(n)}`,
  item_code: `1.${String(n)}`,
  description_ar: `بند ${String(n)}`,
  description_en: `Line ${String(n)}`,
  qty,
  unit,
  unit_price: '65.0000',
  discount_pct: '0.0000',
  line_total: '14300.0000',
  provisional: n === 2,
  sort_order: n,
});

/** An issued BOQ contract as app_contract_by_token answers: one open section, one past the opening window. */
const CONTRACT = {
  id: CONTRACT_ID,
  number: 1,
  status: 'issued',
  title_ar: 'فيلا',
  title_en: 'Villa',
  org: { name_ar: 'نون', name_en: 'Noon', logo_file_id: null },
  source: 'boq',
  signed: null,
  taxable_base: '826950.0000',
  tax_rate: '14.0000',
  tax_amount: '115773.0000',
  supervision_pct: '10.0000',
  supervision_amount: '82695.0000',
  original_value: '826950.0000',
  total: '1025418.0000',
  advance_pct: '0.0000',
  retention_pct: '0.0000',
  payment_schedule: [
    { label_ar: 'دفعة مقدمة', label_en: 'Advance', basis: 'percent', value: '50.0000', sort_order: 0 },
    { label_ar: 'عند التسليم', label_en: 'Handover', basis: 'percent', value: '50.0000', sort_order: 1 },
  ],
  section_count: 2,
  sections: [
    {
      id: 's-1', title_ar: 'أعمال الهدم', title_en: 'Demolition', section_subtotal: '113650.0000', sort_order: 0, line_count: 3,
      lines: [line(1, 'sqm', '220.0000'), line(2, 'linear_meter', '12.3456'), line(3, 'cbm', '0.1250')],
    },
    { id: 's-2', title_ar: 'الأرضيات', title_en: 'Floors', section_subtotal: '420300.0000', sort_order: 1, line_count: 2, lines: [] },
  ],
} as unknown as PublicContract;

const REISSUED_ID = '0b6f8e0c-2c1d-4c55-9c1a-6a1c8f0d0009';

/** The Execution tab's card naming an issued contract; `nameContract` re-reads the page with another id named (a refresh after a re-issue). */
let nameContract: (contractId: string) => void = () => {};
function RefreshedCard() {
  const execution = shapeHome(homePayload('sign_contract'))?.execution as HomeExecution;
  const [contractId, setContractId] = useState(CONTRACT_ID);
  nameContract = setContractId;
  const named = { ...execution, contract: execution.contract && { ...execution.contract, id: contractId } };
  return <ExecutionContract token="tok" execution={named} firmName="Noon" showsDesignRecord={false} />;
}

const LATER_LINES = { section_id: 's-2', offset: 0, line_count: 2, lines: [line(4, 'pcs', '42.0000'), line(5, 'roll', '3.5000')] };

/** The markup with every class dropped: /c draws glass cards, the home flat ones; nothing else may differ. */
function markup(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const node of [copy, ...copy.querySelectorAll('*')]) node.removeAttribute('class');
  return copy.outerHTML;
}

async function tap(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

beforeEach(() => {
  for (const mock of [home.open, home.sections, home.lines, link.sections, link.lines]) mock.mockReset();
  home.open.mockResolvedValue({ ok: true, contract: contractDocumentOf(CONTRACT) });
});

describe.each<TestLocale>(['en', 'ar-EG'])('the contract in the client home (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('closed with the page: no read until the tap; one read opens it; hiding and showing reads nothing', async () => {
    renderWithIntl(<ContractDocumentDisclosure token="tok" contractId={CONTRACT_ID} />, { locale });
    expect(home.open).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('row')).toHaveLength(0);
    const toggle = screen.getByRole('button', { name: at('delivery.contract.document.show') });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await tap(at('delivery.contract.document.show'));
    expect(home.open).toHaveBeenCalledTimes(1);
    expect(home.open).toHaveBeenLastCalledWith('tok', CONTRACT_ID);
    expect(screen.getByRole('button', { name: at('delivery.contract.document.hide') }).getAttribute('aria-expanded')).toBe('true');
    await tap(at('delivery.contract.document.hide'));
    expect(document.getElementById('home-contract-document')?.hidden).toBe(true);
    await tap(at('delivery.contract.document.show'));
    expect(document.getElementById('home-contract-document')?.hidden).toBe(false);
    expect(home.open).toHaveBeenCalledTimes(1);
  });

  test('two taps in the same tick read once (H6-read F6); a failed read can be asked again', async () => {
    let answer: (value: unknown) => void = () => {};
    home.open.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    renderWithIntl(<ContractDocumentDisclosure token="tok" contractId={CONTRACT_ID} />, { locale });
    const toggle = screen.getByRole('button', { name: at('delivery.contract.document.show') });
    await act(async () => {
      toggle.click();
      toggle.click();
    });
    await act(async () => answer({ ok: false, error: 'gone' }));
    expect(home.open).toHaveBeenCalledTimes(1);
    await tap(at('delivery.contract.document.show'));
    expect(home.open).toHaveBeenCalledTimes(2);
    expect(document.getElementById('home-contract-document')).not.toBeNull();
  });

  test('a card that comes to name another contract never keeps the old document under it (key={contract.id})', async () => {
    renderWithIntl(<RefreshedCard />, { locale });
    await tap(at('delivery.contract.document.show'));
    expect(document.getElementById('home-contract-document')).not.toBeNull();
    await act(async () => nameContract(REISSUED_ID));
    expect(document.getElementById('home-contract-document')).toBeNull();
    expect(screen.getByRole('button', { name: at('delivery.contract.document.show') }).getAttribute('aria-expanded')).toBe('false');
    await tap(at('delivery.contract.document.show'));
    expect(home.open).toHaveBeenLastCalledWith('tok', REISSUED_ID);
  });

  test('a collapsed section reads its lines once, through the home link, when expanded', async () => {
    renderWithIntl(<ContractDocumentDisclosure token="tok" contractId={CONTRACT_ID} />, { locale });
    await tap(at('delivery.contract.document.show'));
    home.lines.mockResolvedValueOnce({ ok: true, page: LATER_LINES });
    await tap(at('portal.contract.lines.show').replace('{count}', '2'));
    expect(home.lines).toHaveBeenCalledTimes(1);
    expect(home.lines).toHaveBeenLastCalledWith('tok', 's-2', 0);
    expect(link.lines).not.toHaveBeenCalled();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(5);
  });

  test('PARITY: the same contract renders the same document as /c, opened and with a section expanded', async () => {
    const page = renderWithIntl(<PublicContractView token="c-tok" contract={CONTRACT} />, { locale });
    const shownByLink = () => [...(page.container.firstElementChild?.children ?? [])].slice(1, 4).map(markup);
    link.lines.mockResolvedValueOnce({ ok: true, page: LATER_LINES });
    const closedByLink = shownByLink();
    await tap(at('portal.contract.lines.show').replace('{count}', '2'));
    const expandedByLink = shownByLink();
    page.unmount();

    renderWithIntl(<ContractDocumentDisclosure token="tok" contractId={CONTRACT_ID} />, { locale });
    await tap(at('delivery.contract.document.show'));
    const shownByHome = () => [...(document.getElementById('home-contract-document')?.children ?? [])].map(markup);
    expect(shownByHome()).toEqual(closedByLink);
    home.lines.mockResolvedValueOnce({ ok: true, page: LATER_LINES });
    await tap(at('portal.contract.lines.show').replace('{count}', '2'));
    expect(shownByHome()).toEqual(expandedByLink);
    expect(expandedByLink.join('')).toContain(messageAt(locale, 'portal.units.roll'));
  });

  test('a contract no longer shown is said and stays closed; a shared failure is said in the portal words', async () => {
    home.open.mockResolvedValueOnce({ ok: false, error: 'gone' });
    renderWithIntl(<ContractDocumentDisclosure token="tok" contractId={CONTRACT_ID} />, { locale });
    await tap(at('delivery.contract.document.show'));
    expect(screen.getByRole('alert').textContent).toBe(at('delivery.contract.document.gone'));
    expect(document.getElementById('home-contract-document')).toBeNull();
    home.open.mockResolvedValueOnce({ ok: false, error: 'too_many' });
    await tap(at('delivery.contract.document.show'));
    expect(screen.getByRole('alert').textContent).toBe(at('portal.errors.too_many'));
    home.open.mockRejectedValueOnce(new Error('network'));
    await tap(at('delivery.contract.document.show'));
    expect(screen.getByRole('alert').textContent).toBe(at('delivery.contract.document.loadFailed'));
  });
});
