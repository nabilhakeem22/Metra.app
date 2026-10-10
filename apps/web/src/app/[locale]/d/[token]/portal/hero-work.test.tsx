import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { answerDialog, confirmDialog, renderCommandCard } from '@/test/portal-command-card';
import { messageAt } from '@/test/render-with-intl';

// AC 53 to 56 on the page: the design hero shows the renders under Approve and
// the dialog repeats the first; with the budget offered, ONE confirmation sends
// approveDesignWithBudget; a stale tab is told the decision SAVED; a step that
// moved on says so once, for every hero, and re-reads the page.

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
const DESIGN = { kind: 'action', group: 'design', showRomAck: true } as const;
const VERBS = ['approve_design', 'request_design_changes'];
const render = (n: number): PortalDocument => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`,
  category: 'render',
  sharedAt: '2026-10-01T09:00:00.000Z',
  commentCount: 0,
  access: 'preview',
  media: 'image',
});
const RENDERS = [1, 2, 3, 4, 5].map(render);
const ROM = { low: '900000.0000', high: '1200000.0000' };

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  router.refresh.mockReset();
});

describe('the design hero shows the work first (AC 53)', () => {
  it('four render tiles right under Approve, "View all" for the fifth, the first repeated in the dialog', async () => {
    renderCommandCard({ hero: DESIGN, clientActions: VERBS, stageKey: 'finalApproval', documents: RENDERS });
    const strip = screen.getByRole('group', { name: en('delivery.hero.work.title') });
    expect(within(strip).getAllByRole('img').map((image) => image.getAttribute('src'))).toEqual(
      RENDERS.slice(0, 4).map((image) => `/en/d/tok/documents/${image.id}?variant=thumb`),
    );
    expect(within(strip).getByRole('button', { name: 'View all (5)' })).toBeTruthy();
    const approve = screen.getByRole('button', { name: en('delivery.hero.design.approve') });
    // F3: Approve comes first (on the first screen), the work right under it, then the note.
    expect(approve.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(screen.getByRole('textbox')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(approve);
    const dialog = await confirmDialog();
    expect(within(dialog).getByRole('img').getAttribute('src')).toBe(`/en/d/tok/documents/${RENDERS[0]!.id}?variant=thumb`);
  });

  it('no render to show: a link down to the documents', () => {
    renderCommandCard({ hero: DESIGN, clientActions: VERBS, stageKey: 'finalApproval' });
    expect(screen.getByRole('link', { name: en('delivery.hero.work.seeFiles') }).getAttribute('href')).toBe('#documents');
  });
});

describe('work the client cannot see yet (F8)', () => {
  it('says so instead of asking for an approval blind', () => {
    const locked = { ...render(1), access: 'withheld' as const };
    renderCommandCard({ hero: DESIGN, clientActions: VERBS, stageKey: 'finalApproval', documents: [locked] });
    expect(screen.getByText(en('delivery.hero.work.locked'))).toBeTruthy();
    expect(screen.queryByRole('link', { name: en('delivery.hero.work.seeFiles') })).toBeNull();
  });
});

describe('approve with the budget (AC 54)', () => {
  it('the dialog shows the range and says so; Confirm sends ONE approveDesignWithBudget', async () => {
    actions.approveDesignWithBudget.mockResolvedValue({ kind: 'approved', studioNotified: true, budgetAcknowledged: true });
    renderCommandCard({ hero: DESIGN, clientActions: [...VERBS, 'acknowledge_rom'], stageKey: 'finalApproval', rom: ROM });
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.design.approve') }));
    const dialog = await confirmDialog();
    expect(within(dialog).getByText(en('delivery.hero.design.confirmWithBudget'))).toBeTruthy();
    expect(dialog.textContent).toContain('900,000');
    await answerDialog('en', 'confirm');
    await act(async () => {});
    expect(actions.approveDesignWithBudget).toHaveBeenCalledTimes(1);
    // F1: the band and the round this dialog showed travel with the act.
    expect(actions.approveDesignWithBudget).toHaveBeenCalledWith('tok', '', { band: '900000.0000..1200000.0000', round: '|' });
    expect(actions.respondToDeliveryDesign).not.toHaveBeenCalled();
    expect(screen.getByText(en('delivery.hero.design.budgetAcknowledged'))).toBeTruthy();
  });

  it('without the budget on offer, a plain approval', async () => {
    actions.respondToDeliveryDesign.mockResolvedValue({ kind: 'approved', studioNotified: false });
    renderCommandCard({ hero: DESIGN, clientActions: VERBS, stageKey: 'finalApproval', rom: ROM });
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.design.approve') }));
    expect(within(await confirmDialog()).queryByText(en('delivery.hero.design.confirmWithBudget'))).toBeNull();
    await answerDialog('en', 'confirm');
    await act(async () => {});
    expect(actions.approveDesignWithBudget).not.toHaveBeenCalled();
    expect(screen.queryByText(en('delivery.hero.design.budgetAcknowledged'))).toBeNull();
  });
});

describe('saved decisions (AC 55, 56)', () => {
  it('a stale tab asking for changes over a saved approval is told "approved"', async () => {
    actions.respondToDeliveryDesign.mockResolvedValue({ kind: 'approved', studioNotified: true });
    renderCommandCard({ hero: DESIGN, clientActions: VERBS, stageKey: 'finalApproval' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Darker wood' } });
    fireEvent.click(screen.getByRole('button', { name: en('delivery.hero.design.changes') }));
    await act(async () => {});
    expect(screen.getByText(en('delivery.hero.design.approvedTitle'))).toBeTruthy();
    expect(screen.queryByText(en('delivery.hero.design.changesTitle'))).toBeNull();
  });

  it.each([
    ['design', 'respondToDeliveryDesign', 'approve', VERBS],
    ['handoff', 'acknowledgeDeliveryHandover', 'acknowledge', ['acknowledge_handoff']],
  ] as const)('%s moved on: one shared message, and the page re-reads', async (group, action, button, offered) => {
    actions[action].mockResolvedValue({ kind: 'moved_on' });
    renderCommandCard({ hero: { kind: 'action', group, showRomAck: false }, clientActions: [...offered] });
    fireEvent.click(screen.getByRole('button', { name: en(`delivery.hero.${group}.${button}`) }));
    await answerDialog('en', 'confirm');
    expect((await screen.findByRole('alert')).textContent).toBe(en('delivery.actions.movedOn'));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
