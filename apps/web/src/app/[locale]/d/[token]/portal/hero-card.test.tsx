import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerDialog, renderCommandCard } from '@/test/portal-command-card';
import { messageAt, type TestLocale } from '@/test/render-with-intl';

// Which hero the client sees: the option picker, the plain CTA or the calm card,
// offering only the verbs the client is offered, and every refusal through a key
// the catalog holds.

const actions = vi.hoisted(() => ({
  recordDeliveryAction: vi.fn(),
  chooseDeliveryConcept: vi.fn(),
  respondToDeliveryConcept: vi.fn(),
}));
vi.mock('../actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const en = (path: string) => messageAt('en', path);
const OPTION_A = '11111111-1111-4111-8111-111111111111';
const OPTION_B = '22222222-2222-4222-8222-222222222222';
const TWO_OPTIONS = [
  { id: OPTION_A, position: 1 as const, letter: 'A' as const },
  { id: OPTION_B, position: 2 as const, letter: 'B' as const },
];
const OFFERED = ['approve_concept', 'request_concept_changes'];
const CONCEPT = { kind: 'action', group: 'concept', showRomAck: false } as const;

beforeEach(() => {
  actions.recordDeliveryAction.mockReset();
  actions.respondToDeliveryConcept.mockReset();
  router.refresh.mockReset();
});

describe('the hero at the concept review (B12)', () => {
  it('with 2 to 4 released options it is the picker: no plain Approve, Request changes kept', () => {
    renderCommandCard({ hero: CONCEPT, clientActions: OFFERED, conceptOptions: TWO_OPTIONS });
    expect(screen.getByText(en('delivery.conceptPicker.title'))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: en('delivery.conceptPicker.choose') })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: en('delivery.hero.concept.approve') })).toBeNull();
    expect(screen.getByRole('button', { name: en('delivery.hero.concept.changes') })).toBeTruthy();
  });

  it.each([
    ['no option', []],
    ['one option', TWO_OPTIONS.slice(0, 1)],
  ])('with %s it keeps the plain Approve / Request changes', (_label, conceptOptions) => {
    renderCommandCard({ hero: CONCEPT, clientActions: OFFERED, conceptOptions });
    expect(screen.getByRole('button', { name: en('delivery.hero.concept.approve') })).toBeTruthy();
    expect(screen.queryByText(en('delivery.conceptPicker.title'))).toBeNull();
  });

  it('without approve_concept on offer it is not the picker', () => {
    renderCommandCard({ hero: CONCEPT, clientActions: ['request_concept_changes'], conceptOptions: TWO_OPTIONS });
    expect(screen.queryByText(en('delivery.conceptPicker.title'))).toBeNull();
  });

  it('a retracted change request still holding its slot: Request changes is not offered', () => {
    renderCommandCard({ hero: CONCEPT, clientActions: ['approve_concept'] });
    expect(screen.getByRole('button', { name: en('delivery.hero.concept.approve') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en('delivery.hero.concept.changes') })).toBeNull();
  });

  it('a retracted approval holding its slot: only Request changes is offered', () => {
    renderCommandCard({ hero: CONCEPT, clientActions: ['request_concept_changes'] });
    expect(screen.queryByRole('button', { name: en('delivery.hero.concept.approve') })).toBeNull();
    expect(screen.getByRole('button', { name: en('delivery.hero.concept.changes') })).toBeTruthy();
  });
});

describe('the calm hero repeats the saved choice (B12)', () => {
  function renderCalm(kind: 'inProgress' | 'delivered' | 'closed', locale: TestLocale) {
    return renderCommandCard(
      { hero: { kind, showRomAck: false }, clientActions: [], conceptChoice: { id: OPTION_B, letter: 'B' } },
      { locale },
    );
  }

  it('names the letter saved with the choice, in both locales', () => {
    const english = renderCalm('inProgress', 'en');
    expect(screen.getByText('You chose option ⁨B⁩.')).toBeTruthy();
    english.unmount();
    renderCalm('delivered', 'ar-EG');
    expect(screen.getByText('اخترتَ البديل ⁨B⁩.')).toBeTruthy();
  });

  it('says nothing about it once the delivery is closed', () => {
    renderCalm('closed', 'en');
    expect(screen.queryByText(/You chose option/)).toBeNull();
  });
});

describe('a refusal always reads from the catalog', () => {
  it('an error code the portal has no copy for shows the generic message', async () => {
    actions.recordDeliveryAction.mockResolvedValue({ ok: false, error: 'contract_inactive' });
    renderCommandCard({
      hero: { kind: 'action', group: 'design', showRomAck: false },
      clientActions: ['approve_design', 'request_design_changes'],
    });
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.design.approve') }));
    await answerDialog('en', 'confirm');
    await act(async () => {});
    expect((await screen.findByRole('alert')).textContent).toBe(en('delivery.actions.error.generic'));
    // The hero stays, so the client can try again; nothing was confirmed.
    expect(screen.getByRole('button', { name: en('delivery.hero.design.approve') })).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('a rejected action leaves no spinner stuck and shows the generic message', async () => {
    actions.recordDeliveryAction.mockRejectedValue(new Error('network'));
    renderCommandCard({
      hero: { kind: 'action', group: 'handoff', showRomAck: false },
      clientActions: ['acknowledge_handoff'],
    });
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.handoff.acknowledge') }));
    await answerDialog('en', 'confirm');
    expect((await screen.findByRole('alert')).textContent).toBe(en('delivery.actions.error.generic'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: en('delivery.hero.handoff.acknowledge') }).hasAttribute('disabled')).toBe(false),
    );
  });
});
