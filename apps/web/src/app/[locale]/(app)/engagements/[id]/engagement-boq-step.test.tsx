import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { BoqStepData } from '@/lib/boqs/step';
import { EngagementBoqStep } from './engagement-boq-step';

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
  usePathname: () => '/en/engagements/e-1',
}));

// 'use server' module: replaced, so no server-only stack is loaded.
const actions = vi.hoisted(() => ({ openBoqProposal: vi.fn() }));
vi.mock('@/lib/boq-proposals/actions', () => actions);

const toasts = vi.hoisted(() => [] as Array<{ title?: string }>);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: { title?: string }) => {
    toasts.push(raised);
  },
}));

const en = (path: string) => messageAt('en', path);

const step = (over: Partial<BoqStepData> = {}): BoqStepData => ({
  current: null,
  boqProposalId: null,
  clientCanOpen: false,
  sharedWithClient: true,
  canBuild: true,
  ...over,
});

const sent = {
  id: 'b1',
  status: 'issued',
  lineCount: 14,
  documentNumber: 'BQ-2026-0014',
  total: '159900.0000',
};

function renderStep(data: BoqStepData) {
  return renderWithIntl(
    <EngagementBoqStep engagementId="e-1" projectId="p-1" step={data} />,
    { locale: 'en' },
  );
}

describe('EngagementBoqStep: start (AC15)', () => {
  it('offers Create the BOQ, opens the working copy, and goes to the builder', async () => {
    actions.openBoqProposal.mockResolvedValue({ ok: true, data: 'prop-1' });
    renderStep(step());
    const upload = screen.getByRole('link', { name: en('engagements.boqStep.uploadInstead') });
    expect(upload.getAttribute('href')).toContain('/projects/p-1?tab=boq');

    fireEvent.click(screen.getByRole('button', { name: en('engagements.boqStep.createCta') }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/proposals/prop-1'));
    expect(actions.openBoqProposal).toHaveBeenCalledWith('e-1');
  });

  it('a refused open toasts the coded error and stays put', async () => {
    router.push.mockClear();
    actions.openBoqProposal.mockResolvedValue({ ok: false, error: 'forbidden' });
    renderStep(step());
    fireEvent.click(screen.getByRole('button', { name: en('engagements.boqStep.createCta') }));
    await waitFor(() => expect(toasts.at(-1)?.title).toBe(en('errors.forbidden')));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('reads Continue the BOQ, linking to the builder, once the working copy exists', () => {
    renderStep(step({ boqProposalId: 'prop-1' }));
    const link = screen.getByRole('link', { name: en('engagements.boqStep.continueCta') });
    expect(link.getAttribute('href')).toContain('/proposals/prop-1');
  });

  it('offers neither control to a role that may not build', () => {
    renderStep(step({ canBuild: false }));
    expect(screen.queryByText(en('engagements.boqStep.createCta'))).toBeNull();
    expect(screen.queryByText(en('engagements.boqStep.uploadInstead'))).toBeNull();
  });
});

describe('EngagementBoqStep: done (AC16)', () => {
  it('names the server-formatted number, the lines, the total and the locked chip', () => {
    renderStep(step({ current: sent, boqProposalId: 'prop-1' }));
    expect(screen.getByText(/BQ-2026-0014/).textContent).toContain('14');
    expect(screen.getByText('159,900.00', { exact: false })).toBeTruthy();
    expect(screen.getByText(en('engagements.boqStep.chipLocked'))).toBeTruthy();
    expect(
      screen.getByRole('link', { name: en('engagements.boqStep.viewBoq') }).getAttribute('href'),
    ).toContain('/projects/p-1?tab=boq');
    expect(
      screen
        .getByRole('link', { name: en('engagements.boqStep.editNewVersion') })
        .getAttribute('href'),
    ).toContain('/proposals/prop-1');
  });

  it('shows the open chip once settled, and no edit link without a working copy', () => {
    renderStep(step({ current: sent, clientCanOpen: true }));
    expect(screen.getByText(en('engagements.boqStep.chipOpen'))).toBeTruthy();
    expect(screen.queryByText(en('engagements.boqStep.editNewVersion'))).toBeNull();
  });

  it('says "issued, not shared with the client", with no chip, when the client cannot see it (F2)', () => {
    renderStep(step({ current: sent, sharedWithClient: false, clientCanOpen: true }));
    expect(screen.getByText(/BQ-2026-0014 issued, not shared with the client/)).toBeTruthy();
    expect(screen.getByText(en('engagements.boqStep.unsharedHint'))).toBeTruthy();
    expect(screen.queryByText(/BQ-2026-0014 sent/)).toBeNull();
    expect(screen.queryByText(en('engagements.boqStep.chipOpen'))).toBeNull();
    expect(screen.queryByText(en('engagements.boqStep.chipLocked'))).toBeNull();
  });

  it('renders no Arabic-Indic digit in the Arabic done line', () => {
    const { container } = renderWithIntl(
      <EngagementBoqStep engagementId="e-1" projectId="p-1" step={step({ current: sent })} />,
    );
    expect(container.textContent).toContain('BQ-2026-0014');
    expect(/[٠-٩۰-۹]/.test(container.textContent ?? '')).toBe(false);
  });
});

describe('EngagementBoqStep: issue (S1)', () => {
  const draft = { ...sent, status: 'draft' };

  it('says the client cannot open it yet when the BOQ rule does not release it', () => {
    renderStep(step({ current: draft, clientCanOpen: false }));
    expect(screen.getByText(/withheld until the design fee is paid/)).toBeTruthy();
    expect(screen.queryByText(/open it right away/)).toBeNull();
  });

  it('says the client can open it right away when the rule releases it', () => {
    renderStep(step({ current: draft, clientCanOpen: true }));
    expect(screen.getByText(/open it right away/)).toBeTruthy();
  });
});
