import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PublicContractView } from '@/app/[locale]/c/[token]/public-contract';
import { PublicProposalView } from '@/app/[locale]/p/[token]/public-proposal';
import { PublicVariationView } from '@/app/[locale]/v/[token]/public-variation';
import type { PublicContract } from '@/lib/contracts/public';
import type { PublicProposal } from '@/lib/proposals/public';
import type { PublicVariation } from '@/lib/variations/public';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// W3.6 (AC 30, as the lead ruled against R4): on /p, /c and /v an answer that
// never landed is said from portal.errors (فصحى), with the reference of an
// unknown failure; a request that rejected may have been recorded, so it says
// `uncertain` (refresh and check before sending again), never "could not
// reach". The decision stays open with its buttons enabled, and the page never
// claims the client already answered or that the link is not valid.

const answers = vi.hoisted(() => ({
  respondToProposal: vi.fn(),
  acknowledgeContract: vi.fn(),
  respondToVariation: vi.fn(),
}));
vi.mock('@/app/[locale]/p/[token]/actions', () => ({ respondToProposal: answers.respondToProposal }));
vi.mock('@/app/[locale]/c/[token]/actions', () => ({ acknowledgeContract: answers.acknowledgeContract }));
vi.mock('@/app/[locale]/v/[token]/actions', () => ({ respondToVariation: answers.respondToVariation }));

const ORG = { name_ar: 'ستوديو', name_en: 'Studio', logo_file_id: null };
const PROPOSAL = {
  number: 1, status: 'sent', title_ar: null, title_en: 'Fit-out', issue_date: null, tax_rate: '14',
  subtotal: '100', discount_amount: '0', tax_amount: '14', total: '114', org: ORG, sections: [],
} as unknown as PublicProposal;
const CONTRACT = {
  number: 1, status: 'issued', title_ar: null, title_en: 'Fit-out', total: '114', advance_pct: '10',
  retention_pct: '5', org: ORG, sections: [], source: 'proposal', payment_schedule: [],
} as unknown as PublicContract;
const VARIATION = {
  number: 1, status: 'issued', title_ar: null, title_en: 'Doors', reason_ar: null, reason_en: null,
  net_delta: '100', contractActive: true, rejectionChannel: null, org: ORG, lines: [],
} as unknown as PublicVariation;

interface Page {
  name: string;
  show: () => void;
  answer: ReturnType<typeof vi.fn>;
  button: string;
  /** What the page must NOT claim when the answer never landed. */
  notSaid: string[];
}

const PAGES: Page[] = [
  {
    name: '/p',
    show: () => renderWithIntl(<PublicProposalView token="t" proposal={PROPOSAL} />, { locale: current }),
    answer: answers.respondToProposal,
    button: 'proposals.p.accept',
    notSaid: ['proposals.p.alreadyResponded', 'proposals.p.invalid'],
  },
  {
    name: '/c',
    show: () => renderWithIntl(<PublicContractView token="t" contract={CONTRACT} />, { locale: current }),
    answer: answers.acknowledgeContract,
    button: 'contracts.ack.button',
    notSaid: ['contracts.ack.already', 'contracts.ack.invalid'],
  },
  {
    name: '/v',
    show: () => renderWithIntl(<PublicVariationView token="t" variation={VARIATION} />, { locale: current }),
    answer: answers.respondToVariation,
    button: 'variations.client.approve',
    notSaid: ['variations.client.already', 'variations.client.invalid'],
  },
];

let current: TestLocale = 'en';

beforeEach(() => {
  for (const answer of Object.values(answers)) answer.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('a link page whose answer never landed (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const withReference = (reference: string) =>
    `${at('portal.errors.generic')} ${at('portal.errors.reference').replace('{reference}', reference)}`;

  async function answerWith(page: Page, settle: (answer: Page['answer']) => void) {
    current = locale;
    settle(page.answer);
    page.show();
    const name = document.querySelector('input');
    if (name) fireEvent.change(name, { target: { value: 'Mona' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at(page.button) }));
    });
  }

  function expectStillOpen(page: Page, message: string) {
    expect(screen.getByRole('alert').textContent).toBe(message);
    expect(screen.getByRole('button', { name: at(page.button) }).hasAttribute('disabled')).toBe(false);
    for (const key of page.notSaid) expect(document.body.textContent).not.toContain(at(key));
  }

  test.each(PAGES)('$name: an unknown failure says so, with its reference', async (page) => {
    await answerWith(page, (answer) => answer.mockResolvedValue({ ok: false, error: 'generic', reference: 'K7Q29MXD' }));
    expectStillOpen(page, withReference('K7Q29MXD'));
  });

  test.each(PAGES)('$name: an unconfirmed answer says to refresh and check', async (page) => {
    await answerWith(page, (answer) => answer.mockResolvedValue({ ok: false, error: 'uncertain' }));
    expectStillOpen(page, at('portal.errors.uncertain'));
  });

  test.each(PAGES)('$name: a dropped connection may have been recorded: refresh and check', async (page) => {
    await answerWith(page, (answer) => answer.mockRejectedValue(new TypeError('Failed to fetch')));
    expectStillOpen(page, at('portal.errors.uncertain'));
  });

  test.each(PAGES)('$name: a server throw is the same unconfirmed answer', async (page) => {
    await answerWith(page, (answer) => answer.mockRejectedValue(Object.assign(new Error('boom'), { digest: '4242' })));
    expectStillOpen(page, at('portal.errors.uncertain'));
  });
});

// F7: every link page labels its name box; /c never disables Acknowledge for a
// blank name, and pressing it says, under the labelled box, to write the name.
describe.each<TestLocale>(['en', 'ar-EG'])('the signer name (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test.each([
    ['/p', () => renderWithIntl(<PublicProposalView token="t" proposal={PROPOSAL} />, { locale }), 'proposals.p.yourName'],
    ['/c', () => renderWithIntl(<PublicContractView token="t" contract={CONTRACT} />, { locale }), 'contracts.ack.nameLabel'],
    ['/v', () => renderWithIntl(<PublicVariationView token="t" variation={VARIATION} />, { locale }), 'variations.client.nameLabel'],
  ])('%s labels its name box', (_page, show, label) => {
    show();
    expect(screen.getByLabelText(at(label)).tagName).toBe('INPUT');
  });

  test('/c: a blank name is said under the box, with focus there, and nothing is sent', async () => {
    renderWithIntl(<PublicContractView token="t" contract={CONTRACT} />, { locale });
    const button = screen.getByRole('button', { name: at('contracts.ack.button') });
    expect(button.hasAttribute('disabled')).toBe(false);
    await act(async () => {
      fireEvent.click(button);
    });
    const box = screen.getByLabelText(at('contracts.ack.nameLabel'));
    expect(answers.acknowledgeContract).not.toHaveBeenCalled();
    expect(document.getElementById(`${box.id}-error`)?.textContent).toBe(at('contracts.ack.nameRequired'));
    expect(document.getElementById(`${box.id}-error`)?.hasAttribute('role')).toBe(false);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBe(`${box.id}-error`);
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'Mona' } });
    expect(document.getElementById(`${box.id}-error`)).toBeNull();
  });
});
