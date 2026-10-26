import { screen, within } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeFocus } from '@/lib/client-home/tab';
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
vi.mock('./code-actions', () => ({}));
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

const show = (locale: TestLocale, home: HomeAtExecution, focus: HomeFocus | null = null) =>
  renderWithIntl(<ExecutionTabView token="tok-1" home={home} focus={focus} />, { locale });

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

describe.each<TestLocale>(['ar-EG', 'en'])('the contract card once the signing window has closed (%s, H4 follow-up F1)', (locale) => {
  it('says signing closed in the studio-move tone, as the hero does, and offers nothing to sign', () => {
    show(locale, homeOf('signing_closed'));
    const contract = document.getElementById('contract') as HTMLElement;
    const chip = contract.querySelector('[data-tone]') as HTMLElement;
    expect(chip.textContent).toBe(messageAt(locale, 'delivery.contract.status.signingClosed'));
    expect(chip.getAttribute('data-tone')).toBe('waiting');
    expect(contract.textContent).not.toContain(messageAt(locale, 'delivery.contract.status.issued'));
    expect(within(contract).queryAllByRole('button')).toHaveLength(0);
    expect(within(contract).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('a ?focus= link (H4 follow-up F4: an unknown focus is ignored)', () => {
  const REQUEST = '00000000-0000-4000-8000-0000000000a1';
  const ELSEWHERE = '00000000-0000-4000-8000-000000000099';
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  beforeEach(() => {
    scrolled.length = 0;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.id);
    };
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it('opens on the contract, and on a request the page lists', () => {
    const contract = show('en', homeOf('pay_request'), { section: 'contract' });
    contract.unmount();
    show('en', homeOf('pay_request'), { section: 'request', id: REQUEST });
    expect(scrolled).toEqual(['contract', `request-${REQUEST}`]);
  });

  it('leaves the page at its top for a request it does not list, and for a change order (none is listed by id)', () => {
    const unknownRequest = show('en', homeOf('pay_request'), { section: 'request', id: ELSEWHERE });
    unknownRequest.unmount();
    show('en', homeOf('decide_change_order'), { section: 'variation', id: ELSEWHERE });
    expect(document.getElementById('change-orders')).not.toBeNull();
    expect(scrolled).toEqual([]);
  });
});

describe.each<TestLocale>(['ar-EG', 'en'])('the Execution tab speaks of the studio, never of a design (%s, H4 follow-up 4 and F7)', (locale) => {
  const DESIGN_WORDS = /design|تصميم|مصمم/i;

  /** Everything the page says, to the eye and to a screen reader, and what its links would send. */
  function everythingSaid(container: HTMLElement): string[] {
    const said = [container.textContent ?? ''];
    for (const element of container.querySelectorAll('*')) {
      for (const name of ['aria-label', 'title', 'href']) {
        const value = element.getAttribute(name);
        if (value) said.push(decodeURIComponent(value));
      }
    }
    return said;
  }

  it.each(CLIENT_EXECUTION_REASONS)('a light delivery on %s', (reason) => {
    const home = homeOf(reason, 'execution');
    const money = home.execution.money;
    // The studio's own account holder name is the studio's data, not the page's words.
    const neutral = money?.paymentDetails ? { ...money, paymentDetails: { ...money.paymentDetails, bankAccountHolder: 'Noon' } } : money;
    const { container } = show(locale, { ...home, execution: { ...home.execution, money: neutral } });
    for (const text of everythingSaid(container)) expect(text).not.toMatch(DESIGN_WORDS);
  });

  it('the WhatsApp message, from the studio bar and from the hero, names the project and its reference', () => {
    const { container } = show(locale, homeOf('signing_closed'));
    const message = encodeURIComponent(messageAt(locale, 'delivery.studioBar.execution.whatsappText').replace('{ref}', 'DE-2026-0012'));
    const whatsapp = [...container.querySelectorAll('a[href^="https://wa.me/"]')].map((link) => link.getAttribute('href'));
    expect(whatsapp).toEqual([`https://wa.me/201000000002?text=${message}`, `https://wa.me/201000000002?text=${message}`]);
  });

  it("the payment words the claim answers with are the studio's too", () => {
    for (const key of ['requests.void', 'confirmBody', 'claimNotified', 'earlierClaims.row']) {
      expect(messageAt(locale, `delivery.execution.${key}`)).not.toMatch(DESIGN_WORDS);
    }
    // The code panel the claim opens (H5) is shared with the design tab, so it names neither phase.
    for (const key of ['intro', 'introOnFile', 'sent', 'noChannel', 'error.busy', 'error.requestBusy', 'error.send_failed', 'error.too_many']) {
      expect(messageAt(locale, `delivery.code.${key}`)).not.toMatch(DESIGN_WORDS);
    }
    for (const key of ['not_active', 'reference', 'token_expired', 'token_invalid']) {
      expect(messageAt(locale, `portal.errors.${key}`)).not.toMatch(DESIGN_WORDS);
    }
    expect(messageAt(locale, 'delivery.notFound.body')).not.toMatch(DESIGN_WORDS);
  });
});

describe('the hero on a phone (H4 follow-ups 3 and F8)', () => {
  it('draws the compact rail, the current step named once under it', () => {
    const { container } = show('en', homeOf('sign_contract'));
    const hero = container.querySelector('[data-client-reason]')!.closest('section') as HTMLElement;
    expect(hero.querySelector('[data-rail-current-name]')?.textContent).toBe(messageAt('en', 'delivery.flow.execution.signature'));
  });

  it('lets the whose-move chip wrap, so a long studio name is never cut off', () => {
    const { container } = show('ar-EG', homeOf('signing_closed'));
    const chip = container.querySelector('[data-client-reason] [data-tone]') as HTMLElement;
    expect(chip.className.split(' ')).toContain('whitespace-normal');
    expect(chip.className.split(' ')).not.toContain('whitespace-nowrap');
  });
});
