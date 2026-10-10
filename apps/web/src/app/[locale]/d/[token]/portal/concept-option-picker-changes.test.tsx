import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCommandCard } from '@/test/portal-command-card';
import { messageAt } from '@/test/render-with-intl';

// The picker's "Request changes": offered while the SDF offers it, sent with the
// client's note (a request for changes needs one), and confirmed only as the
// decision SAVED on file.

const actions = vi.hoisted(() => ({ chooseDeliveryConcept: vi.fn(), respondToDeliveryConcept: vi.fn() }));
vi.mock('../review-actions', () => actions);
vi.mock('../actions', () => ({}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const OPTIONS = [
  { id: '11111111-1111-4111-8111-111111111111', position: 1 as const, letter: 'A' as const },
  { id: '22222222-2222-4222-8222-222222222222', position: 2 as const, letter: 'B' as const },
  { id: '33333333-3333-4333-8333-333333333333', position: 3 as const, letter: 'C' as const },
];
const en = (path: string) => messageAt('en', path);

function renderPicker(canRequestChanges = true) {
  return renderCommandCard(
    {
      hero: { kind: 'action', group: 'concept', showRomAck: false },
      clientActions: canRequestChanges ? ['approve_concept', 'request_concept_changes'] : ['approve_concept'],
      conceptOptions: OPTIONS,
    },
    { token: 'tok/1' },
  );
}

async function requestChanges(note: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: note } });
  fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.concept.changes') }));
  await act(async () => {});
}

beforeEach(() => {
  actions.chooseDeliveryConcept.mockReset();
  actions.respondToDeliveryConcept.mockReset();
  router.refresh.mockReset();
});

describe('ConceptOptionPicker: Request changes', () => {
  it('is disabled while the note is blank, with the hint', () => {
    renderPicker();
    const changes = screen.getByRole('button', { name: en('delivery.hero.concept.changes') });
    expect(changes.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(en('delivery.actions.changesNeedNote')).id).toBe(changes.getAttribute('aria-describedby'));
  });

  it('stays while offered, through the concept respond action, with the note', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'changes_requested', studioNotified: false });
    renderPicker();
    await requestChanges('Warmer colours');
    expect(actions.respondToDeliveryConcept).toHaveBeenCalledWith('tok/1', 'request_concept_changes', 'Warmer colours');
    expect(await screen.findByText(en('delivery.hero.concept.changesBody'))).toBeTruthy();
    expect(actions.chooseDeliveryConcept).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('a retracted change request holding its slot: Request changes is not offered', () => {
    renderPicker(false);
    expect(screen.queryByRole('button', { name: en('delivery.hero.concept.changes') })).toBeNull();
    expect(screen.queryByText(en('delivery.actions.changesNeedNote'))).toBeNull();
    expect(screen.getAllByRole('button', { name: en('delivery.conceptPicker.choose') })).toHaveLength(3);
  });

  it('a stale Request changes over a saved choice says the choice, never "changes requested"', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'chosen', letter: 'B', studioNotified: true });
    renderPicker();
    await requestChanges('Warmer colours');
    expect(
      await screen.findByText(en('delivery.conceptPicker.chosen').replace('{letter}', '⁨B⁩')),
    ).toBeTruthy();
    expect(screen.queryByText(en('delivery.hero.concept.changesTitle'))).toBeNull();
  });

  it('a repeat with nothing live on file says the step moved on and refreshes', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'moved_on' });
    renderPicker();
    await requestChanges('Warmer colours');
    expect((await screen.findByRole('alert')).textContent).toBe(en('delivery.actions.movedOn'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
