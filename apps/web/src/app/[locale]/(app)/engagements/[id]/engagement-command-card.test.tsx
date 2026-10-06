import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { EngagementCommandCardProps } from './command-card-props';
import { EngagementCommandCard } from './engagement-command-card';

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
  usePathname: () => '/ar-EG/engagements/e-1',
}));

// 'use server' modules reach requireOrg and the server-only stack.
const actions = vi.hoisted(() => ({
  chooseDesignOnly: vi.fn(),
  chooseExecution: vi.fn(),
  recordPayment: vi.fn(),
  logPaymentAndAdvance: vi.fn(),
  confirmPaymentClaim: vi.fn(),
  dismissPaymentClaim: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => actions);
vi.mock('@/lib/boq-proposals/actions', () => ({ openBoqProposal: vi.fn() }));
vi.mock('./trigger-actions', () => ({
  DIRECT_TRIGGER_ACTIONS: {
    chooseDesignOnly: actions.chooseDesignOnly,
    chooseExecution: actions.chooseExecution,
  },
}));

afterEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
});

const ar = (path: string) => messageAt('ar-EG', path);

const ENDINGS: EngagementGatePreview['endingChoices'] = ['chooseDesignOnly', 'chooseExecution'];

/** The execution_decision gate: the two endings, behind the balance. */
function choicePreview(balanceCleared: boolean): EngagementGatePreview {
  return {
    primaryTrigger: null,
    endingChoices: ENDINGS,
    items: [
      {
        guard: 'balanceCleared',
        ok: balanceCleared,
        code: balanceCleared ? null : 'balance_not_cleared',
        amountDue: balanceCleared ? null : '30000.0000',
      },
    ],
    allClear: balanceCleared,
  };
}

function props(overrides: Partial<EngagementCommandCardProps> = {}): EngagementCommandCardProps {
  return {
    engagementId: 'e-1',
    projectId: 'p-1',
    boqStep: { current: null, boqProposalId: null, clientCanOpen: false, sharedWithClient: false, canBuild: false },
    preview: choicePreview(true),
    state: 'execution_decision',
    allowances: { revisionCount: 0, freeRevisionN: 3, designRevisionCount: 0, freeDesignRevisionN: 3 },
    stallDays: null,
    canAdvance: true,
    canRecordPayment: true,
    canResolveClaims: true,
    canShare: true,
    canUpload: true,
    canSetOffPlan: false,
    offPlan: false,
    paymentClaims: [],
    awaitingReplyCount: 0,
    conceptOptionCount: 0,
    clientActivity: [],
    secondaryTriggers: ['abandon'],
    pending: false,
    runAction: (fn) => {
      void fn('00000001-0000-4000-8000-000000000000');
    },
    onNudge: () => {},
    ...overrides,
  };
}

const button = (key: string) => screen.queryByRole('button', { name: ar(key) });

describe('the ending choice at execution_decision', () => {
  test('balance cleared: two equal ending buttons and no Advance', () => {
    renderWithIntl(<EngagementCommandCard {...props()} />);
    const designOnly = button('engagements.command.ending.chooseDesignOnly.cta');
    const execution = button('engagements.command.ending.chooseExecution.cta');
    expect(designOnly).not.toBeNull();
    expect(execution).not.toBeNull();
    expect(designOnly?.className).toBe(execution?.className);
    expect((designOnly as HTMLButtonElement).disabled).toBe(false);
    expect(button('engagements.hero.advance')).toBeNull();
  });

  test('Not yet in the confirm dialog fires nothing', async () => {
    renderWithIntl(<EngagementCommandCard {...props()} />);
    fireEvent.click(button('engagements.command.ending.chooseExecution.cta')!);
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(ar('engagements.command.ending.chooseExecution.confirmBody')),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: ar('engagements.command.ending.cancel') }),
      );
    });
    expect(actions.chooseExecution).not.toHaveBeenCalled();
    expect(actions.chooseDesignOnly).not.toHaveBeenCalled();
  });

  test('confirming fires exactly the chosen ending', async () => {
    actions.chooseDesignOnly.mockResolvedValue({ ok: true });
    renderWithIntl(<EngagementCommandCard {...props()} />);
    fireEvent.click(button('engagements.command.ending.chooseDesignOnly.cta')!);
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: ar('engagements.command.ending.chooseDesignOnly.cta'),
        }),
      );
    });
    expect(actions.chooseDesignOnly).toHaveBeenCalledTimes(1);
    expect(actions.chooseExecution).not.toHaveBeenCalled();
  });

  test('More actions lists Abandon and neither ending', () => {
    renderWithIntl(<EngagementCommandCard {...props()} />);
    expect(button('engagements.trigger.abandon')).not.toBeNull();
    expect(button('engagements.trigger.chooseDesignOnly')).toBeNull();
    expect(button('engagements.trigger.chooseExecution')).toBeNull();
  });

  test('balance unpaid: Log payment (record only), no endings, no Advance', () => {
    renderWithIntl(<EngagementCommandCard {...props({ preview: choicePreview(false) })} />);
    expect(button('engagements.hero.logPayment')).not.toBeNull();
    expect(button('engagements.hero.logPaymentAdvance')).toBeNull();
    expect(button('engagements.command.ending.chooseDesignOnly.cta')).toBeNull();
    expect(button('engagements.hero.advance')).toBeNull();
  });

  test('the record-only form calls recordPayment, never logPaymentAndAdvance', async () => {
    actions.recordPayment.mockResolvedValue({ ok: true });
    renderWithIntl(<EngagementCommandCard {...props({ preview: choicePreview(false) })} />);
    fireEvent.click(button('engagements.hero.logPayment')!);
    const submits = screen.getAllByRole('button', { name: ar('engagements.hero.logPayment') });
    await act(async () => {
      fireEvent.click(submits[submits.length - 1]);
    });
    expect(actions.recordPayment).toHaveBeenCalledTimes(1);
    expect(actions.recordPayment.mock.calls[0][0]).toMatchObject({
      engagementId: 'e-1',
      kind: 'balance',
      amount: '30000.0000',
    });
    expect(actions.logPaymentAndAdvance).not.toHaveBeenCalled();
  });
});

describe('a pending client payment claim is the card ONE action', () => {
  const claim = {
    id: 'c-1',
    milestoneKind: 'balance' as const,
    claimedAmount: '30000.0000',
    note: null,
    actorName: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };

  test('the claim form shows, with Dismiss, and no Advance, Log payment or endings', () => {
    renderWithIntl(
      <EngagementCommandCard {...props({ preview: choicePreview(false), paymentClaims: [claim] })} />,
    );
    expect(button('engagements.paymentClaims.confirm')).not.toBeNull();
    expect(button('engagements.paymentClaims.dismiss')).not.toBeNull();
    expect(button('engagements.hero.advance')).toBeNull();
    expect(button('engagements.hero.logPayment')).toBeNull();
    expect(button('engagements.hero.logPaymentAdvance')).toBeNull();
    expect(button('engagements.command.ending.chooseDesignOnly.cta')).toBeNull();
    expect(button('engagements.command.ending.chooseExecution.cta')).toBeNull();
  });

  test('confirming sends the edited amount for that claim', async () => {
    actions.confirmPaymentClaim.mockResolvedValue({ ok: true });
    renderWithIntl(
      <EngagementCommandCard {...props({ preview: choicePreview(false), paymentClaims: [claim] })} />,
    );
    fireEvent.change(screen.getByLabelText(ar('engagements.paymentClaims.amount')), {
      target: { value: '29000' },
    });
    await act(async () => {
      fireEvent.click(button('engagements.paymentClaims.confirm')!);
    });
    expect(actions.confirmPaymentClaim).toHaveBeenCalledWith({ claimId: 'c-1', amount: '29000' });
  });

  test('a role that cannot resolve claims does not get the claim form', () => {
    renderWithIntl(
      <EngagementCommandCard
        {...props({ preview: choicePreview(false), paymentClaims: [claim], canResolveClaims: false })}
      />,
    );
    expect(button('engagements.paymentClaims.confirm')).toBeNull();
  });
});
