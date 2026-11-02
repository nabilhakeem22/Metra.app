// TEST-ONLY. The Execution tab's change orders section as a test drives it (H7.1):
// the page around it, which can read itself again, and the client's presses in one
// locale. The test file mocks ../variation-actions and ../code-actions before it
// imports this module.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { Mock } from 'vitest';
import { ExecutionChangeOrders } from '@/app/[locale]/d/[token]/portal/execution-change-orders';
import type { HomeChangeOrder } from '@/lib/client-home/types';
import { bidiIsolate } from '@/lib/format/bidi';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

export const A = '00000000-0000-4000-8000-0000000000a1';
export const B = '00000000-0000-4000-8000-0000000000b1';
export const HINT = 'c•••@e•••.com';
export const STUDIO = { name: 'Noon Studio', whatsappDigits: '201000000002', deliveryRef: 'DE-2026-0012' };

export const orderOf = (id: string, number: number, over: Partial<HomeChangeOrder> = {}): HomeChangeOrder => ({
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

/** The page read again in another state (a refresh). */
export let readAgain: (orders: HomeChangeOrder[] | null, openCount: number) => void = () => {};

function Section({ orders, openCount, channel, openOn, onChanged }: { orders: HomeChangeOrder[] | null; openCount: number; channel: { hint: string } | null; openOn: string | null; onChanged: () => void }) {
  const [page, setPage] = useState({ orders, openCount });
  readAgain = (next, count) => setPage({ orders: next, openCount: count });
  return <ExecutionChangeOrders token="tok" orders={page.orders} openCount={page.openCount} channel={channel} studio={STUDIO} openOn={openOn} onChanged={onChanged} />;
}

type Decision = 'approve' | 'reject';

/** The section and the client's presses in `locale`; `decide` is the mocked action, `onChanged` the page's refresh. */
export function sectionDriver(locale: TestLocale, decide: Mock, onChanged: () => void) {
  const at = (key: string) => messageAt(locale, `delivery.changeOrders.${key}`);
  const words = (key: string, number: number) => at(key).replaceAll('{number}', bidiIsolate(String(number))).replaceAll('{studio}', STUDIO.name);
  const mount = (over: { orders?: HomeChangeOrder[] | null; openCount?: number; channel?: { hint: string } | null; openOn?: string | null } = {}) => {
    const orders = over.orders === undefined ? [orderOf(A, 3)] : over.orders;
    const channel = over.channel === undefined ? { hint: HINT } : over.channel;
    return renderWithIntl(<Section orders={orders} openCount={over.openCount ?? orders?.length ?? 0} channel={channel} openOn={over.openOn ?? null} onChanged={onChanged} />, { locale });
  };
  const card = (id = A) => within(document.getElementById(`variation-${id}`) as HTMLElement);
  const nameBox = (id = A) => card(id).getByLabelText(at('decide.nameLabel')) as HTMLInputElement;
  const press = (key: Decision, id = A) => fireEvent.click(card(id).getByRole('button', { name: at(`decide.${key}`) }));
  const dialog = () => screen.findByRole('dialog');
  const confirmButton = async (key: Decision = 'approve') => within(await dialog()).getByRole('button', { name: at(`decide.confirm.${key}`) }) as HTMLButtonElement;
  const codeBox = async () => within(await dialog()).getByLabelText(messageAt(locale, 'delivery.code.label')) as HTMLInputElement;

  async function openWithCode(key: Decision = 'approve', code = '042917', id = A) {
    fireEvent.change(nameBox(id), { target: { value: 'Hesham Adel' } });
    press(key, id);
    fireEvent.click(within(await dialog()).getByRole('button', { name: messageAt(locale, 'delivery.code.send') }));
    await act(async () => {});
    fireEvent.change(await codeBox(), { target: { value: code } });
  }

  async function decideWith(answer: unknown, key: Decision = 'approve') {
    decide.mockResolvedValueOnce(answer);
    await openWithCode(key);
    fireEvent.click(await confirmButton(key));
    await act(async () => {});
  }

  return { at, words, mount, card, nameBox, press, dialog, confirmButton, codeBox, openWithCode, decideWith };
}
