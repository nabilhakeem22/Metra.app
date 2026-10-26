import { screen, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import type { HomeAtExecution } from '@/lib/client-home/types';
import { CLIENT_EXECUTION_REASONS, type ClientExecutionReason } from '@/lib/flow/locate/execution-client';
import { bidiIsolate } from '@/lib/format/bidi';
import { homePayload } from '@/test/client-home-payloads';
import { messageAt, messagesFor, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// The client home's Execution tab (H4.2, AC15 and AC17): for every client
// reason, the hero's sentence and its one act, in both locales, Latin digits
// and no dash; the tab strip only for a delivery that began with a design.

vi.mock('server-only', () => ({}));
vi.mock('./execution-actions', () => ({}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { shapeHome } = await import('@/lib/client-home/shape');
const { ExecutionTabView } = await import('./execution-tab');

const ARABIC_INDIC = /[٠-٩۰-۹]/;
const DASH = /[–—]/;

function homeOf(reason: ClientExecutionReason, entryPhase: 'design' | 'execution' = 'design'): HomeAtExecution {
  const home = shapeHome(homePayload(reason, { entryPhase }));
  if (!home?.execution) throw new Error(`fixture ${reason} is not at execution`);
  return { ...home, execution: home.execution };
}

const show = (locale: TestLocale, home: HomeAtExecution) =>
  renderWithIntl(<ExecutionTabView token="tok-1" home={home} focus={null} />, { locale });

/** The headline each reason says, built from the catalogue with the fixture's facts. */
function expectedHeadline(locale: TestLocale, reason: ClientExecutionReason): string {
  const t = createTranslator({ locale, messages: messagesFor(locale), namespace: 'delivery.home.hero' });
  const studio = locale === 'en' ? 'Noon Studio' : 'استوديو نون';
  const money = (figure: string) => bidiIsolate(`${figure} ${locale === 'en' ? 'EGP' : 'ج.م'}`);
  const values: Record<ClientExecutionReason, [string, Record<string, string | number>]> = {
    preparing_contract: ['preparing_contract', { studio }],
    sign_contract: ['sign_contract', { number: 'C-2026-0004' }],
    signing_closed: ['signing_closed', { studio }],
    decide_change_order: ['decide_change_order', { count: 1, countText: '1' }],
    pay_request: ['pay_request', { number: 'PR-2026-0003', amount: money('57,000') }],
    payment_being_confirmed: ['payment_being_confirmed', { number: 'PR-2026-0003', studio }],
    works_in_progress: ['works_in_progress', { date: bidiIsolate('14/03/2027') }],
    final_account_due: ['final_account_due', { amount: money('1,500.50') }],
    final_account_in_review: ['final_account_in_review', { studio }],
    settled: ['settled', {}],
    terminated: ['terminated', { date: bidiIsolate('25/10/2026') }],
  };
  const [key, params] = values[reason];
  return t.markup(key as 'settled', { ...params, num: (chunks) => chunks });
}

/** The one act each reason offers, and where it leads. */
const ACT: Readonly<Record<ClientExecutionReason, { key: string; href: string | RegExp } | null>> = {
  preparing_contract: null,
  sign_contract: { key: 'reviewContract', href: '#contract' },
  signing_closed: { key: 'whatsapp', href: /^https:\/\/wa\.me\/201000000002\?text=/ },
  decide_change_order: { key: 'reviewChangeOrder', href: '#change-orders' },
  pay_request: { key: 'howToPay', href: '#payments' },
  payment_being_confirmed: null,
  works_in_progress: null,
  final_account_due: { key: 'howToPay', href: '#payments' },
  final_account_in_review: null,
  settled: null,
  terminated: null,
};

const ACT_KEYS = ['reviewContract', 'reviewChangeOrder', 'howToPay', 'whatsapp'] as const;

describe.each<TestLocale>(['ar-EG', 'en'])('the Execution tab hero (%s, AC17)', (locale) => {
  it.each(CLIENT_EXECUTION_REASONS)('%s: says its sentence and offers its one act', (reason) => {
    const { container } = show(locale, homeOf(reason));
    const hero = container.querySelector(`[data-client-reason="${reason}"]`);
    expect(hero).not.toBeNull();
    const heading = within(hero as HTMLElement).getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe(expectedHeadline(locale, reason));
    const act = ACT[reason];
    const studio = locale === 'en' ? 'Noon Studio' : 'استوديو نون';
    const links = within(hero as HTMLElement).queryAllByRole('link');
    const offered = links.filter((link) =>
      ACT_KEYS.some((key) => link.textContent === messageAt(locale, `delivery.home.act.${key}`).replace('{studio}', studio)),
    );
    if (act === null) {
      expect(offered).toHaveLength(0);
    } else {
      expect(offered).toHaveLength(1);
      expect(offered[0].textContent).toBe(messageAt(locale, `delivery.home.act.${act.key}`).replace('{studio}', studio));
      const href = offered[0].getAttribute('href') ?? '';
      if (typeof act.href === 'string') expect(href).toBe(act.href);
      else expect(href).toMatch(act.href);
    }
    const text = container.textContent ?? '';
    expect(ARABIC_INDIC.test(text)).toBe(false);
    expect(DASH.test(text)).toBe(false);
  });

  it('every section an act opens is on the page', () => {
    for (const reason of CLIENT_EXECUTION_REASONS) {
      const act = ACT[reason];
      const { container, unmount } = show(locale, homeOf(reason));
      if (act && typeof act.href === 'string') expect({ reason, found: container.querySelector(act.href) !== null }).toEqual({ reason, found: true });
      unmount();
    }
  });
});

describe('the tab strip (AC15)', () => {
  it('a delivery that began with a design shows Execution as the current tab and links its design record', () => {
    show('en', homeOf('works_in_progress'));
    const tabs = screen.getByRole('navigation', { name: messageAt('en', 'delivery.home.tabs.label') });
    const links = within(tabs).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/en/d/tok-1?tab=execution', '/en/d/tok-1?tab=design']);
    expect(links[0].getAttribute('aria-current')).toBe('page');
    expect(links[1].getAttribute('aria-current')).toBeNull();
  });

  it('a light delivery shows no tab strip, and its language switch keeps the Execution tab', () => {
    show('ar-EG', homeOf('sign_contract', 'execution'));
    expect(screen.queryByRole('navigation', { name: messageAt('ar-EG', 'delivery.home.tabs.label') })).toBeNull();
    expect(screen.getByRole('link', { name: messageAt('ar-EG', 'delivery.language.switchTo') }).getAttribute('href')).toBe('/en/d/tok-1?tab=execution');
  });
});

describe('the sections (H4 notes: change orders the client can no longer answer)', () => {
  it('a lapsed change order is said in the hero, with no section to answer it', () => {
    const home = homeOf('works_in_progress');
    show('en', { ...home, execution: { ...home.execution, lapsedVariationCount: 2 } });
    expect(screen.getByText(/Noon Studio will contact you/)).toBeTruthy();
    expect(document.getElementById('change-orders')).toBeNull();
  });

  it('a contract waiting for a signature says where to sign it; a signed one says when and how', () => {
    const { unmount } = show('en', homeOf('sign_contract'));
    const contract = document.getElementById('contract') as HTMLElement;
    expect(contract.textContent).toContain('C-2026-0004');
    expect(contract.textContent).toContain(messageAt('en', 'delivery.contract.signWithLink').replace('{studio}', 'Noon Studio'));
    unmount();
    show('en', homeOf('works_in_progress'));
    const signed = document.getElementById('contract') as HTMLElement;
    expect(signed.textContent).toContain('03/10/2026');
    expect(signed.textContent).toContain('14/03/2027');
  });
});
