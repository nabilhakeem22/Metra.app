import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PublicContractView } from '@/app/[locale]/c/[token]/public-contract';
import { PublicProposalView } from '@/app/[locale]/p/[token]/public-proposal';
import type { PublicContract } from '@/lib/contracts/public';
import type { PublicProposal } from '@/lib/proposals/public';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';

// P4a: on /p and /c an act the link's budget refused is said from
// portal.errors.too_many ("wait a minute"). Nothing was written, so the
// decision stays open with its button enabled, and the page never claims the
// client already answered or that the link is not valid.

const answers = vi.hoisted(() => ({ respondToProposal: vi.fn(), acknowledgeContract: vi.fn() }));
vi.mock('@/app/[locale]/p/[token]/actions', () => ({ respondToProposal: answers.respondToProposal }));
vi.mock('@/app/[locale]/c/[token]/actions', () => ({ acknowledgeContract: answers.acknowledgeContract }));

const ORG = { name_ar: 'ستوديو', name_en: 'Studio', logo_file_id: null };
const PROPOSAL = {
  number: 1, status: 'sent', title_ar: null, title_en: 'Fit-out', issue_date: null, tax_rate: '14',
  subtotal: '100', discount_amount: '0', tax_amount: '14', total: '114', org: ORG, sections: [],
} as unknown as PublicProposal;
const CONTRACT = {
  number: 1, status: 'issued', title_ar: null, title_en: 'Fit-out', total: '114', advance_pct: '10',
  retention_pct: '5', org: ORG, sections: [], section_count: 0, signed: null, source: 'proposal', payment_schedule: [],
} as unknown as PublicContract;

interface Page {
  name: string;
  show: (locale: TestLocale) => void;
  answer: ReturnType<typeof vi.fn>;
  button: string;
  /** What the page must NOT claim when the budget refused the act. */
  notSaid: string[];
}

const PAGES: Page[] = [
  {
    name: '/p',
    show: (locale) => renderWithIntl(<PublicProposalView token="t" proposal={PROPOSAL} />, { locale }),
    answer: answers.respondToProposal,
    button: 'proposals.p.accept',
    notSaid: ['proposals.p.alreadyResponded', 'proposals.p.invalid', 'proposals.p.decisionAccepted'],
  },
  {
    name: '/c',
    show: (locale) => renderWithIntl(<PublicContractView token="t" contract={CONTRACT} />, { locale }),
    answer: answers.acknowledgeContract,
    button: 'contracts.ack.button',
    notSaid: ['contracts.ack.already', 'contracts.ack.invalid', 'contracts.ack.done'],
  },
];

beforeEach(() => {
  for (const answer of Object.values(answers)) answer.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('a link page whose act the budget refused (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test.each(PAGES)('$name: says to wait a minute, and keeps the decision open', async (page) => {
    page.answer.mockResolvedValue({ ok: false, error: 'too_many' });
    page.show(locale);
    const name = document.querySelector('input');
    if (name) fireEvent.change(name, { target: { value: 'Mona' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at(page.button) }));
    });
    expect(screen.getByRole('alert').textContent).toBe(at('portal.errors.too_many'));
    expect(screen.getByRole('button', { name: at(page.button) }).hasAttribute('disabled')).toBe(false);
    for (const key of page.notSaid) expect(document.body.textContent).not.toContain(at(key));
  });
});
