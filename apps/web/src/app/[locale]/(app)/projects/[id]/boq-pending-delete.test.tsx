import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useToast } from '@/hooks/use-toast';
import type { BoqDetail } from '@/lib/boqs/queries';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { BoqTab } from './boq-tab';

// Ported from the A2 testers' repro (t1a2/boq-issue-race, a2-rel/boq-issue-race):
// a line deleted inside its Undo window must be gone from every figure, and an
// Issue sent inside that window must reach the server AFTER the delete.

const calls = vi.hoisted(() => [] as string[]);
const actions = vi.hoisted(() => ({
  addBoqLine: vi.fn(),
  addBoqSection: vi.fn(),
  setBoqDiscount: vi.fn(),
  updateBoqLine: vi.fn(),
  deleteBoqLine: vi.fn(async (input: { lineId: string }) => {
    calls.push(`delete:${input.lineId}`);
    return { ok: true };
  }),
  issueBoq: vi.fn(async (boqId: string) => {
    calls.push(`issue:${boqId}`);
    return { ok: true };
  }),
}));
vi.mock('@/lib/boqs/actions', () => actions);

let toastApi: ReturnType<typeof useToast> | null = null;
function ToastApi() {
  toastApi = useToast();
  return null;
}

afterEach(() => {
  act(() => toastApi?.dismiss());
  calls.length = 0;
  actions.deleteBoqLine.mockClear();
  actions.issueBoq.mockClear();
});

const ar = (path: string) => messageAt('ar-EG', path);
const line = (id: string, description: string) => ({
  id,
  itemCode: '1',
  description,
  unit: 'sqm',
  qty: '1.0000',
  unitPrice: '100.0000',
  discountPct: '0.0000',
  lineTotal: '100.0000',
  provisional: false,
});
const boq = {
  id: 'boq-1',
  number: 1,
  documentNumber: 'BQ-2026-0001',
  version: 1,
  title: 'BOQ',
  status: 'draft',
  source: 'manual',
  currency: 'EGP',
  discountPct: '0.0000',
  subtotal: '200.0000',
  discountAmount: '0.0000',
  total: '200.0000',
  lineCount: 2,
  sections: [
    { id: 's1', title: 'S', sectionSubtotal: '200.0000', lines: [line('keep', 'KEEP'), line('stray', 'STRAY')] },
  ],
} as BoqDetail;

function renderTab(detail: BoqDetail = boq, locale: 'ar-EG' | 'en' = 'ar-EG') {
  renderWithIntl(
    <>
      <BoqTab projectId="p1" boq={detail} canBuild canSeeCost={false} clientCanOpenOnIssue={false} />
      <ToastApi />
    </>,
    { locale },
  );
}

const deleteButtons = () => screen.getAllByRole('button', { name: ar('projects.profile.boq.deleteLine') });
const issueButton = () => screen.getByRole('button', { name: ar('projects.profile.boq.issue') });

describe('a BOQ line held for Undo', () => {
  test('is gone from the rows, the line count and the totals', () => {
    renderTab(boq, 'en');
    expect(document.body.textContent).toContain('200');
    expect(document.body.textContent).toContain('BQ-2026-0001 · 2 lines');
    fireEvent.click(
      screen.getAllByRole('button', { name: messageAt('en', 'projects.profile.boq.deleteLine') })[1]!,
    );
    expect(screen.queryAllByDisplayValue('STRAY')).toHaveLength(0);
    expect(screen.queryAllByDisplayValue('KEEP')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('200');
    expect(document.body.textContent).toContain('BQ-2026-0001 · 1 line');
    expect(actions.deleteBoqLine).not.toHaveBeenCalled();
  });

  test('Issue inside the window commits the delete first, then issues', async () => {
    renderTab();
    fireEvent.click(deleteButtons()[1]!);
    fireEvent.click(issueButton());
    fireEvent.click(await screen.findByRole('button', { name: ar('projects.profile.boq.issueConfirm') }));
    await waitFor(() => expect(calls).toEqual(['delete:stray', 'issue:boq-1']));
  });

  test('a refused delete stops the Issue: the line is back, nothing is issued', async () => {
    actions.deleteBoqLine.mockImplementationOnce(async () => ({ ok: false, error: 'boq_not_draft' }));
    renderTab();
    fireEvent.click(deleteButtons()[1]!);
    fireEvent.click(issueButton());
    fireEvent.click(await screen.findByRole('button', { name: ar('projects.profile.boq.issueConfirm') }));
    await waitFor(() => expect(screen.queryAllByDisplayValue('STRAY')).toHaveLength(1));
    expect(actions.issueBoq).not.toHaveBeenCalled();
  });

  test('hiding the only line disables Issue', () => {
    renderTab({ ...boq, lineCount: 1, sections: [{ ...boq.sections[0]!, lines: [line('keep', 'KEEP')] }] });
    expect((issueButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(deleteButtons()[0]!);
    expect((issueButton() as HTMLButtonElement).disabled).toBe(true);
  });
});
