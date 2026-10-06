import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { EngagementGatePreview } from '@/lib/engagements/gate-preview';
import { openMenu } from '@/test/open-menu';
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
  abandon: vi.fn(),
}));
vi.mock('@/lib/engagements/actions', () => actions);
const toasts = vi.hoisted(() => [] as { title?: string; description?: string }[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: { title?: string; description?: string }) => {
    toasts.push(raised);
  },
}));
vi.mock('@/lib/boq-proposals/actions', () => ({ openBoqProposal: vi.fn() }));
vi.mock('./trigger-actions', () => ({
  DIRECT_TRIGGER_ACTIONS: {
    chooseDesignOnly: actions.chooseDesignOnly,
    chooseExecution: actions.chooseExecution,
    abandon: actions.abandon,
  },
}));

afterEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  toasts.length = 0;
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
    status: { kind: 'yourMove' },
    canAdvance: true,
    canRecordPayment: true,
    canResolveClaims: true,
    canShare: true,
    canStartQuotation: true,
    canUpload: true,
    canSetOffPlan: false,
    offPlan: false,
    feeSplitPrefill: null,
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

async function waitForDialogToClose(): Promise<void> {
  await act(async () => {});
  expect(screen.queryByRole('alertdialog')).toBeNull();
}

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

  test('a role that may not choose the ending sees who decides, not the buttons', () => {
    renderWithIntl(<EngagementCommandCard {...props({ canAdvance: false })} />);
    expect(button('engagements.command.ending.chooseDesignOnly.cta')).toBeNull();
    expect(button('engagements.command.ending.chooseExecution.cta')).toBeNull();
    expect(screen.getByText(ar('engagements.command.ending.decidedBy'))).toBeTruthy();
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

  test('More actions keeps Abandon in its menu and lists neither ending', () => {
    renderWithIntl(<EngagementCommandCard {...props()} />);
    expect(button('engagements.trigger.abandon')).toBeNull();
    expect(button('engagements.trigger.chooseDesignOnly')).toBeNull();
    expect(button('engagements.trigger.chooseExecution')).toBeNull();
    openMenu(ar('common.moreActions'));
    expect(screen.getByRole('menuitem', { name: ar('engagements.trigger.abandon') })).toBeTruthy();
  });

  test('Abandon fires only after its confirm; Cancel fires nothing', async () => {
    actions.abandon.mockResolvedValue({ ok: true });
    renderWithIntl(<EngagementCommandCard {...props()} />);
    const chooseAbandon = () => {
      openMenu(ar('common.moreActions'));
      fireEvent.click(screen.getByRole('menuitem', { name: ar('engagements.trigger.abandon') }));
    };

    chooseAbandon();
    fireEvent.click(
      await screen.findByRole('button', { name: ar('engagements.command.abandonConfirmCancel') }),
    );
    await waitForDialogToClose();
    expect(actions.abandon).not.toHaveBeenCalled();

    chooseAbandon();
    fireEvent.click(
      await screen.findByRole('button', { name: ar('engagements.command.abandonConfirmCta') }),
    );
    await act(async () => {});
    expect(actions.abandon).toHaveBeenCalledTimes(1);
    expect(actions.abandon).toHaveBeenCalledWith('e-1');
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

describe('a closed delivery', () => {
  const closedPreview: EngagementGatePreview = {
    primaryTrigger: null,
    endingChoices: [],
    items: [],
    allClear: true,
  };
  const closedProps = (state: EngagementCommandCardProps['state'], extra = {}) =>
    props({ state, preview: closedPreview, secondaryTriggers: [], ...extra });
  const link = (key: string) => screen.queryByRole('link', { name: ar(key) });

  test('at execution: its own headline, View BOQ and Start a quotation, no nudge footer', () => {
    renderWithIntl(<EngagementCommandCard {...closedProps('execution')} />);
    expect(screen.getByText(ar('engagements.command.closed.execution.headline'))).toBeTruthy();
    expect(link('engagements.command.closed.execution.viewBoq')?.getAttribute('href')).toContain(
      '/projects/p-1?tab=boq',
    );
    expect(
      link('engagements.command.closed.execution.startQuotation')?.getAttribute('href'),
    ).toContain('/proposals/new?projectId=p-1');
    expect(screen.queryByRole('button', { name: ar('engagements.command.nudge') })).toBeNull();
  });

  test('Start a quotation needs proposals_build create', () => {
    renderWithIntl(<EngagementCommandCard {...closedProps('execution', { canStartQuotation: false })} />);
    expect(link('engagements.command.closed.execution.viewBoq')).not.toBeNull();
    expect(link('engagements.command.closed.execution.startQuotation')).toBeNull();
  });

  test('closed_design_only and abandoned say how they ended, with no links', () => {
    const { unmount } = renderWithIntl(<EngagementCommandCard {...closedProps('closed_design_only')} />);
    expect(
      screen.getByText(ar('engagements.command.closed.closed_design_only.headline')),
    ).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    unmount();
    renderWithIntl(<EngagementCommandCard {...closedProps('abandoned')} />);
    expect(screen.getByText(ar('engagements.command.closed.abandoned.headline'))).toBeTruthy();
  });

  // A claim the client sent before the delivery closed has no other way off
  // the page: the payment can no longer be recorded, but it can be dismissed.
  const pendingClaim = {
    id: 'claim-1',
    milestoneKind: 'balance' as const,
    claimedAmount: '30000.0000',
    note: null,
    actorName: 'Client',
    createdAt: '2026-06-01T00:00:00.000Z',
  };

  test('a pending claim on a closed delivery can be dismissed, and nothing else', async () => {
    actions.dismissPaymentClaim.mockResolvedValue({ ok: true });
    renderWithIntl(
      <EngagementCommandCard
        {...closedProps('closed_design_only', { paymentClaims: [pendingClaim] })}
      />,
    );
    expect(screen.getByText(ar('engagements.paymentClaims.closedHint'))).toBeTruthy();
    expect(button('engagements.paymentClaims.confirm')).toBeNull();
    fireEvent.click(button('engagements.paymentClaims.dismiss')!);
    await act(async () => {});
    expect(actions.dismissPaymentClaim).toHaveBeenCalledWith({ claimId: 'claim-1' });
  });

  test('a role that cannot resolve claims does not get the Dismiss', () => {
    renderWithIntl(
      <EngagementCommandCard
        {...closedProps('execution', { paymentClaims: [pendingClaim], canResolveClaims: false })}
      />,
    );
    expect(button('engagements.paymentClaims.dismiss')).toBeNull();
  });
});

describe('a claim confirm that would also move the delivery asks first (S2)', () => {
  const gateAClaim = {
    id: 'c-2',
    milestoneKind: 'gate_a' as const,
    claimedAmount: '20000.0000',
    note: null,
    actorName: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };
  const conceptReview: EngagementGatePreview = {
    primaryTrigger: 'selectConcept',
    endingChoices: [],
    items: [
      { guard: 'gateAInstallmentCleared', ok: false, code: 'gate_a_not_cleared', amountDue: '20000.0000' },
    ],
    allClear: false,
  };
  const render = () =>
    renderWithIntl(
      <EngagementCommandCard
        {...props({ state: 'concept_review', preview: conceptReview, paymentClaims: [gateAClaim] })}
      />,
    );

  test('the dialog names the next stage; Not yet confirms nothing', async () => {
    render();
    fireEvent.click(button('engagements.paymentClaims.confirm')!);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain(ar('engagements.state.negotiation'));
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: ar('engagements.command.claim.cancel') }),
      );
    });
    expect(actions.confirmPaymentClaim).not.toHaveBeenCalled();
  });

  test('confirming in the dialog records it; a refused advance reads "payment recorded" plus why', async () => {
    actions.confirmPaymentClaim.mockResolvedValue({
      ok: true,
      advanced: false,
      waitingOn: 'gate_a_not_cleared',
    });
    render();
    fireEvent.click(button('engagements.paymentClaims.confirm')!);
    const dialog = await screen.findByRole('alertdialog');
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: ar('engagements.paymentClaims.confirm') }),
      );
    });
    expect(actions.confirmPaymentClaim).toHaveBeenCalledWith({ claimId: 'c-2', amount: '20000' });
    expect(toasts.at(-1)).toEqual({
      title: ar('engagements.command.claim.recorded'),
      description: ar('errors.gate_a_not_cleared'),
    });
  });
});
