import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ExecutionCardView } from '@/lib/execution/card-view';
import { NEXT_ACTION_TARGET } from '@/lib/execution/next-action-target';
import { EXECUTION_NEXT_ACTION_KINDS, type ExecutionNextActionKind } from '@/lib/execution/stage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { CommandCardExecution } from './command-card-execution';

// AC10: at `execution` the delivery card shows exactly one next action per
// derived stage, and that action is a control the studio can press: a link to
// the page that does it, or the dialog that does it in place. A role that may
// not take it is told who can, never shown a dead button.

vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/contracts/actions', () => ({
  generateExecutionContract: vi.fn(),
  recordContractSignedOffline: vi.fn(),
}));

const EVERYTHING = { generateContract: true, signOffline: true, openContract: true };
const NOTHING = { generateContract: false, signOffline: false, openContract: false };

function view(kind: ExecutionNextActionKind, may = EVERYTHING): ExecutionCardView {
  return {
    stage: kind === 'record_signed_offline' ? 'awaiting_signature' : 'in_progress',
    next: { kind },
    projectId: 'p-1',
    boqId: 'b-1',
    contract: { id: 'c-1', documentNumber: 'C-2026-0007' },
    may,
  };
}

/** The control the dialog opens with: its own button label. */
const DIALOG_BUTTON = {
  generate_contract: 'contracts.execution.generate.open',
  sign_offline: 'contracts.execution.signOffline.open',
} as const;

describe.each<TestLocale>(['en', 'ar-EG'])('the execution card (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test.each([...EXECUTION_NEXT_ACTION_KINDS])('%s: one control that takes the action', (kind) => {
    renderWithIntl(<CommandCardExecution view={view(kind)} />, { locale });
    const target = NEXT_ACTION_TARGET[kind];
    if (target.kind === 'dialog') {
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.getByRole('button', { name: at(DIALOG_BUTTON[target.dialog]) })).toBeTruthy();
      expect(screen.queryAllByRole('link')).toHaveLength(0);
    } else {
      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(1);
      expect(links[0].textContent).toBe(at(`execution.card.next.${kind}`));
      expect(links[0].getAttribute('href')).toMatch(target.page === 'project_boq' ? /\/projects\/p-1\?tab=boq$/ : /\/contracts\/c-1/);
    }
  });

  test('a role that may not take the action is told who can, with no button and no link', () => {
    for (const kind of ['create_contract', 'record_signed_offline', 'send_contract'] as const) {
      const { unmount } = renderWithIntl(<CommandCardExecution view={view(kind, NOTHING)} />, { locale });
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(screen.queryAllByRole('link')).toHaveLength(0);
      expect(screen.getByText(at('execution.card.someoneElse'))).toBeTruthy();
      unmount();
    }
  });

  test('the BOQ link needs no contract permission; settled shows the stage and no action', () => {
    const { unmount } = renderWithIntl(
      <CommandCardExecution view={{ ...view('open_boq', NOTHING), stage: 'no_boq', contract: null }} />,
      { locale },
    );
    expect(screen.getByRole('link', { name: at('execution.card.next.open_boq') })).toBeTruthy();
    unmount();
    renderWithIntl(<CommandCardExecution view={{ ...view('record_payment'), stage: 'settled', next: null }} />, { locale });
    expect(screen.getByText(at('execution.card.stage.settled'))).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  test('awaiting signature says the client is next, beside recording a paper signature', () => {
    renderWithIntl(<CommandCardExecution view={view('record_signed_offline')} />, { locale });
    expect(screen.getByText(at('execution.card.waitingOnClient'))).toBeTruthy();
    expect(screen.getByText(at('execution.card.stage.awaiting_signature'))).toBeTruthy();
  });
});
