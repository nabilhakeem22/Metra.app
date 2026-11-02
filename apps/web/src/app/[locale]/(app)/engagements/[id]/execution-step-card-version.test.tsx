import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { executionCardView, type ExecutionCardView } from '@/lib/execution/card-view';
import { executionPosition, type ExecutionFlowFacts } from '@/lib/flow/locate/execution-facts';
import { executionModels, flowFactsOf } from '@/test/execution-flow-model';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ExecutionNextAction } from './command-card-execution';

// A draft version on the project (lead ruling R-F1): the cockpit does not offer a
// Create the server would refuse. It says why, and links to the tab where the draft
// is issued. Only Create changes: every other next action, and a role that may not
// create, stay as they were.

vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/contracts/actions', () => ({
  generateExecutionContract: vi.fn(),
  recordContractSignedOffline: vi.fn(),
}));

const MAY_CREATE = {
  generateContract: true,
  signOffline: true,
  openContract: true,
  recordCosts: false,
  sendRequests: true,
  recordPayments: true,
  recordMeasurements: false,
};

function flowWithNext(kind: string): ExecutionFlowFacts {
  const flow = [...executionModels(1)].map(flowFactsOf).find((facts) => executionPosition(facts).result.next?.kind === kind);
  if (!flow) throw new Error(`no model shows ${kind}`);
  return flow;
}

function view(kind: string, versionInProgress: boolean, may = MAY_CREATE): ExecutionCardView {
  const flow = flowWithNext(kind);
  const contract = flow.stage.contract;
  return executionCardView(
    {
      flow,
      boqId: 'b-1',
      contract: contract && { id: 'c-1', number: 7, createdAt: '2026-10-01T09:00:00.000Z', status: contract.status },
      nextInstalment: null,
      signed: null,
    },
    { projectId: 'p-1', versionInProgress, may },
  );
}

function renderAction(cardView: ExecutionCardView, locale: TestLocale) {
  return renderWithIntl(<ExecutionNextAction view={cardView} kind={cardView.next!.kind} label="the label" />, { locale });
}

describe.each<TestLocale>(['en', 'ar-EG'])('the Create control with a version in progress (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('a draft on the project: no Create, the sentence, and a link to the BOQ tab', () => {
    renderAction(view('create_contract', true), locale);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(at('errors.boq_version_in_progress'))).toBeTruthy();
    const link = screen.getByRole('link', { name: at('execution.card.next.open_boq') });
    expect(link.getAttribute('href')).toMatch(/\/projects\/p-1\?tab=boq$/);
  });

  test('no draft: Create, and neither the sentence nor the link', () => {
    renderAction(view('create_contract', false), locale);
    expect(screen.getByRole('button', { name: at('contracts.execution.generate.open') })).toBeTruthy();
    expect(screen.queryByText(at('errors.boq_version_in_progress'))).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('a role that may not create is still told who can, draft or no draft', () => {
    renderAction(view('create_contract', true, { ...MAY_CREATE, generateContract: false }), locale);
    expect(screen.getByText(at('execution.card.someoneElse'))).toBeTruthy();
    expect(screen.queryByText(at('errors.boq_version_in_progress'))).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('a draft beside a contract changes nothing: the next action keeps its own control', () => {
    renderAction(view('send_contract', true), locale);
    expect(screen.getByRole('link', { name: 'the label' }).getAttribute('href')).toMatch(/\/contracts\/c-1$/);
    expect(screen.queryByText(at('errors.boq_version_in_progress'))).toBeNull();
  });
});
