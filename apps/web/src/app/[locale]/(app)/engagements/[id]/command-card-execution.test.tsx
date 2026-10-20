import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ExecutionCardView } from '@/lib/execution/card-view';
import { NEXT_ACTION_TARGET, STAGES_RECORDING_COSTS, STATUS_LINE_ACTIONS } from '@/lib/execution/next-action-target';
import { EXECUTION_NEXT_ACTION_KINDS, EXECUTION_STAGES, type ExecutionNextActionKind } from '@/lib/execution/stage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { CommandCardExecution } from './command-card-execution';

// AC10: at `execution` the delivery card shows exactly one next action per
// derived stage, and that action is a control the studio can press: a link to
// the page that does it, or the dialog that does it in place. A role that may
// not take it is told who can, never shown a dead button. A money step whose
// screen arrives with PR A4 or A5 is a plain status line (lead ruling F2).

vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/contracts/actions', () => ({
  generateExecutionContract: vi.fn(),
  recordContractSignedOffline: vi.fn(),
}));

// "Record costs" sits beside the next action, not in its place: the per-action
// counts below leave it off, and the costs test turns it on.
const EVERYTHING = { generateContract: true, signOffline: true, openContract: true, recordCosts: false };
const NOTHING = { generateContract: false, signOffline: false, openContract: false, recordCosts: false };

function view(kind: ExecutionNextActionKind, may = EVERYTHING): ExecutionCardView {
  return {
    stage: kind === 'record_signed_offline' ? 'awaiting_signature' : 'in_progress',
    next: { kind },
    projectId: 'p-1',
    boqId: 'b-1',
    contract: { id: 'c-1', documentNumber: 'C-2026-0007' },
    nextInstalment: { labelAr: 'دفعة مقدمة', labelEn: 'Advance' },
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

  test.each([...EXECUTION_NEXT_ACTION_KINDS])('%s: one control that takes the action, or its status line', (kind) => {
    renderWithIntl(<CommandCardExecution view={view(kind)} />, { locale });
    const target = NEXT_ACTION_TARGET[kind];
    if (target.kind === 'status') {
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(screen.queryAllByRole('link')).toHaveLength(0);
      const instalment = locale === 'en' ? 'Advance' : 'دفعة مقدمة';
      expect(screen.getByText(at(`execution.card.upcoming.${kind}`).replace('{instalment}', instalment))).toBeTruthy();
    } else if (target.kind === 'dialog') {
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

  test('the money steps A4 and A5 build are status lines, the next payment request naming its instalment (F2)', () => {
    expect([...STATUS_LINE_ACTIONS].sort()).toEqual(
      EXECUTION_NEXT_ACTION_KINDS.filter((kind) => NEXT_ACTION_TARGET[kind].kind === 'status').sort(),
    );
    renderWithIntl(<CommandCardExecution view={{ ...view('send_milestone_request'), nextInstalment: null }} />, { locale });
    const text = at('execution.card.upcoming.send_milestone_request').replace('{instalment}', at('execution.card.upcoming.anInstalment'));
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(at('execution.card.someoneElse'))).toBeNull();
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

  test('"Record costs" opens the costs page for a role that records them, from works in progress on (F1)', () => {
    const costs = at('execution.card.recordCosts');
    for (const stage of EXECUTION_STAGES) {
      const { unmount } = renderWithIntl(
        <CommandCardExecution view={{ ...view('record_payment', { ...NOTHING, recordCosts: true }), stage }} />,
        { locale },
      );
      const link = screen.queryByRole('link', { name: costs });
      if (STAGES_RECORDING_COSTS.has(stage)) expect(link?.getAttribute('href')).toMatch(/\/contracts\/c-1\/costs$/);
      else expect(link).toBeNull();
      unmount();
    }
    renderWithIntl(<CommandCardExecution view={view('record_payment', EVERYTHING)} />, { locale });
    expect(screen.queryByRole('link', { name: costs })).toBeNull();
  });
});
