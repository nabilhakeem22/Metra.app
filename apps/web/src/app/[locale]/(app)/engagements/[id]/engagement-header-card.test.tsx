import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import type { EngagementHeader } from '@/lib/engagements/queries';
import { openMenu } from '@/test/open-menu';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { EngagementHeaderCard } from './engagement-header-card';

vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));
// 'use server' modules reach requireOrg and the server-only stack.
const actions = vi.hoisted(() => ({
  shareDeliveryLink: vi.fn(),
  revealDeliveryLink: vi.fn(),
  rotateDeliveryLink: vi.fn(),
  revokeDeliveryLink: vi.fn(),
  prepareDeliveryReminder: vi.fn(),
  emailDeliveryReminder: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => actions);

const en = (path: string) => messageAt('en', path);

const header: EngagementHeader = {
  id: 'e-1',
  number: 14,
  titleAr: null,
  titleEn: 'Villa',
  clientId: 'c-1',
  projectId: 'p-1',
  clientNameEn: 'Acme',
  clientNameAr: null,
  projectNameEn: 'Tower',
  projectNameAr: null,
  state: 'design_3d',
  designFee: '100000.0000',
  offPlan: true,
  asBuiltDue: true,
  freeRevisionN: 3,
  revisionCount: 0,
  freeDesignRevisionN: 3,
  designRevisionCount: 0,
  romLow: null,
  romHigh: null,
  romIssuedAt: null,
  conceptLockedAt: '2026-05-01T00:00:00.000Z',
  renderManifestHash: null,
  rendersReadyAt: null,
  clientExpected: null,
  clientHasEmail: true,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

function renderHeader(
  canShare: boolean,
  state: EngagementHeader['state'] = header.state,
  status: DeliveryStatus = { kind: 'waitingClient', days: 3 },
) {
  return renderWithIntl(
    <EngagementHeaderCard
      header={{ ...header, state }}
      shared={false}
      status={status}
      canShare={canShare}
      crumbs={{ clientId: 'c-1', clientName: 'Acme', projectId: 'p-1', projectName: 'Tower' }}
    />,
    { locale: 'en' },
  );
}

describe('the delivery header chips speak the StatusChip tones', () => {
  test('brand is the status chip alone; concept locked is done, the rest neutral', () => {
    const { container } = renderHeader(false);
    const toneOf = (key: string) =>
      [...container.querySelectorAll('[data-tone]')]
        .find((chip) => chip.textContent === messageAt('en', key))
        ?.getAttribute('data-tone');
    expect(toneOf('engagements.conceptLocked')).toBe('done');
    expect(toneOf('engagements.asBuiltDue')).toBe('neutral');
    expect(toneOf('engagements.offPlan.offPlan')).toBe('neutral');
    const branded = [...container.querySelectorAll('[data-tone]')].filter((chip) =>
      /brand-tint|brand-ink/.test(chip.className),
    );
    expect(branded).toHaveLength(0);
  });
});

describe('the status chip at execution (client home H2)', () => {
  test('it follows whose move it is: the client move waits with no age, the studio move is yours', () => {
    const { container, unmount } = renderHeader(false, 'execution', { kind: 'waitingClient', days: null });
    const chip = container.querySelector('[data-tone="waiting"]');
    expect(chip?.textContent).toBe(en('engagements.status.waitingClient'));
    unmount();
    const mine = renderHeader(false, 'execution', { kind: 'yourMove' });
    expect(mine.container.querySelector('[data-tone="yourMove"]')?.textContent).toBe(en('engagements.status.yourMove'));
  });
});

describe('the header trail and menu', () => {
  test('the trail links to the deliveries, the client and the project, then names the record', () => {
    renderHeader(false);
    const trail = screen.getByRole('navigation', { name: en('engagements.command.crumbLabel') });
    const hrefs = [...trail.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['/en/engagements', '/en/clients/c-1', '/en/projects/p-1']);
    expect(trail.textContent).toContain(en('engagements.title'));
    expect(trail.textContent).toContain('DE-');
  });

  test('without canShare there is no menu and no client link', () => {
    renderHeader(false);
    expect(screen.queryByRole('button', { name: en('common.moreActions') })).toBeNull();
  });

  test('with canShare the menu opens the client link dialog', async () => {
    renderHeader(true);
    openMenu(en('common.moreActions'));
    fireEvent.click(screen.getByRole('menuitem', { name: en('engagements.command.clientLink') }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(en('delivery.share.title'));
    expect(screen.getByRole('button', { name: en('delivery.share.shareCta') })).toBeTruthy();
  });

  test('with canShare the menu opens the reminder, which only reads', async () => {
    actions.prepareDeliveryReminder.mockResolvedValue({ ok: false, error: 'delivery_link_unrecoverable' });
    renderHeader(true);
    openMenu(en('common.moreActions'));
    fireEvent.click(screen.getByRole('menuitem', { name: en('engagements.command.sendReminder') }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(en('engagements.reminder.title'));
    expect(actions.prepareDeliveryReminder).toHaveBeenCalledWith('e-1');
    expect(actions.rotateDeliveryLink).not.toHaveBeenCalled();
  });

  test('a closed delivery offers no reminder', () => {
    renderHeader(true, 'closed_design_only');
    openMenu(en('common.moreActions'));
    expect(screen.queryByRole('menuitem', { name: en('engagements.command.sendReminder') })).toBeNull();
    expect(screen.getByRole('menuitem', { name: en('engagements.command.clientLink') })).toBeTruthy();
  });
});
