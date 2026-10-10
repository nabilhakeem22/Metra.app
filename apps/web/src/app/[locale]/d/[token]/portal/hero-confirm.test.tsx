import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerDialog,
  confirmDialog,
  landRefresh,
  renderCommandCard,
  type CommandCardProps,
} from '@/test/portal-command-card';
import { messageAt } from '@/test/render-with-intl';

// AC 24: approving and confirming the handover ask first (Cancel sends nothing,
// Confirm sends once), the page re-reads itself once, and the confirmation stays
// on screen through that refresh. Request changes needs a note.

const actions = vi.hoisted(() => ({
  chooseDeliveryConcept: vi.fn(),
  respondToDeliveryConcept: vi.fn(),
  respondToDeliveryDesign: vi.fn(),
  approveDesignWithBudget: vi.fn(),
  acknowledgeDeliveryHandover: vi.fn(),
}));
vi.mock('../review-actions', () => actions);
vi.mock('../actions', () => ({}));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const en = (path: string) => messageAt('en', path);
const ONE_OPTION = [{ id: '11111111-1111-4111-8111-111111111111', position: 1 as const, letter: 'A' as const }];
const ACTION = {
  concept: { kind: 'action', group: 'concept', showRomAck: false },
  design: { kind: 'action', group: 'design', showRomAck: false },
  handoff: { kind: 'action', group: 'handoff', showRomAck: false },
} as const;
const CALM: CommandCardProps = { hero: { kind: 'inProgress', showRomAck: false }, clientActions: [], stageKey: 'drawings' };

beforeEach(() => {
  actions.respondToDeliveryDesign.mockReset();
  actions.acknowledgeDeliveryHandover.mockReset();
  actions.respondToDeliveryConcept.mockReset();
  router.refresh.mockReset();
});

describe('approve and acknowledge ask first', () => {
  it.each([
    ['concept, no option', 'concept', 'approve', ['approve_concept', 'request_concept_changes'], []],
    ['concept, one option', 'concept', 'approve', ['approve_concept'], ONE_OPTION],
    ['design', 'design', 'approve', ['approve_design', 'request_design_changes'], []],
    ['handover', 'handoff', 'acknowledge', ['acknowledge_handoff'], []],
  ] as const)('%s: the dialog names the act; Cancel sends nothing', async (_label, group, button, offered, options) => {
    renderCommandCard({ hero: ACTION[group], clientActions: [...offered], conceptOptions: [...options] });
    fireEvent.click(screen.getByRole('button', { name: en(`delivery.hero.${group}.${button}`) }));
    const dialog = await confirmDialog();
    expect(within(dialog).getByText(en(`delivery.hero.${group}.confirmTitle`))).toBeTruthy();
    expect(within(dialog).getByText(en(`delivery.hero.${group}.confirmBody`))).toBeTruthy();
    await answerDialog('en', 'cancel');
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(actions.respondToDeliveryDesign).not.toHaveBeenCalled();
    expect(actions.acknowledgeDeliveryHandover).not.toHaveBeenCalled();
    expect(actions.respondToDeliveryConcept).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('Confirm sends once, refreshes once, and the confirmation survives the refresh', async () => {
    actions.respondToDeliveryDesign.mockResolvedValue({ kind: 'approved', studioNotified: true });
    renderCommandCard(
      { hero: ACTION.design, clientActions: ['approve_design', 'request_design_changes'] },
      { afterRefresh: CALM },
    );
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.design.approve') }));
    await answerDialog('en', 'confirm');
    expect(await screen.findByText(en('delivery.hero.design.approvedBodyNotified'))).toBeTruthy();
    expect(actions.respondToDeliveryDesign).toHaveBeenCalledTimes(1);
    expect(actions.respondToDeliveryDesign).toHaveBeenCalledWith('tok', 'approve_design', '');
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    landRefresh();
    // The server now asks nothing: the confirmation stays, alone (the calm card
    // under it would only repeat it).
    expect(screen.getByText(en('delivery.hero.design.approvedBodyNotified'))).toBeTruthy();
    expect(screen.queryByText(en('delivery.stage.drawings.label'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('delivery.hero.design.approve') })).toBeNull();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('a concept approval goes through the concept respond action, once', async () => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'approved', studioNotified: false });
    renderCommandCard({ hero: ACTION.concept, clientActions: ['approve_concept'] });
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.concept.approve') }));
    await answerDialog('en', 'confirm');
    expect(await screen.findByText(en('delivery.hero.concept.approvedBody'))).toBeTruthy();
    expect(actions.respondToDeliveryConcept).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('Request changes needs a note', () => {
  it.each(['concept', 'design'] as const)('%s: disabled while blank, with the hint; no dialog', async (group) => {
    actions.respondToDeliveryConcept.mockResolvedValue({ kind: 'changes_requested', studioNotified: false });
    actions.respondToDeliveryDesign.mockResolvedValue({ kind: 'changes_requested', studioNotified: false });
    renderCommandCard({
      hero: ACTION[group],
      clientActions: group === 'concept' ? ['approve_concept', 'request_concept_changes'] : ['approve_design', 'request_design_changes'],
    });
    const changes = screen.getByRole('button', { name: en(`delivery.hero.${group}.changes`) });
    expect(changes.hasAttribute('disabled')).toBe(true);
    const hint = screen.getByText(en('delivery.actions.changesNeedNote'));
    expect(changes.getAttribute('aria-describedby')).toBe(hint.id);

    const note = screen.getByRole('textbox');
    for (const invisible of ['   ', '​', '‏⁠', '؜ ']) {
      fireEvent.change(note, { target: { value: invisible } });
      expect(changes.hasAttribute('disabled'), JSON.stringify(invisible)).toBe(true);
    }
    fireEvent.change(note, { target: { value: 'A bigger window' } });
    expect(changes.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(en('delivery.actions.changesNeedNote'))).toBeNull();

    fireEvent.click(changes);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {});
    const sent = group === 'concept' ? actions.respondToDeliveryConcept : actions.respondToDeliveryDesign;
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith('tok', `request_${group}_changes`, 'A bigger window');
    expect(await screen.findByText(en(`delivery.hero.${group}.changesTitle`))).toBeTruthy();
  });

  it('the handover hero offers no Request changes and shows no hint', () => {
    renderCommandCard({ hero: ACTION.handoff, clientActions: ['acknowledge_handoff'] });
    expect(screen.queryByText(en('delivery.actions.changesNeedNote'))).toBeNull();
  });
});
