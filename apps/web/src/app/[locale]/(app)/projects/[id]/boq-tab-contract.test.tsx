import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { BoqDetail } from '@/lib/boqs/queries';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BoqTab } from './boq-tab';

// A3: a draft cannot replace an issued BOQ a live contract stands on, so the tab
// turns Issue off and says why, instead of letting the click render a PDF the
// database then refuses.

vi.mock('@/lib/boqs/actions', () => ({
  addBoqLine: vi.fn(),
  addBoqSection: vi.fn(),
  setBoqDiscount: vi.fn(),
  updateBoqLine: vi.fn(),
  deleteBoqLine: vi.fn(),
  issueBoq: vi.fn(),
}));
vi.mock('@/lib/contracts/actions', () => ({ generateExecutionContract: vi.fn() }));

const draft = {
  id: 'boq-2',
  number: 2,
  documentNumber: 'BQ-2026-0002',
  title: 'BOQ',
  status: 'draft',
  source: 'manual',
  currency: 'EGP',
  discountPct: '0.0000',
  subtotal: '100.0000',
  discountAmount: '0.0000',
  total: '100.0000',
  lineCount: 1,
  sections: [
    {
      id: 's1',
      title: 'S',
      sectionSubtotal: '100.0000',
      lines: [
        {
          id: 'l1',
          itemCode: '1',
          description: 'KEEP',
          unit: 'sqm',
          qty: '1.0000',
          unitPrice: '100.0000',
          discountPct: '0.0000',
          lineTotal: '100.0000',
          provisional: false,
        },
      ],
    },
  ],
} as BoqDetail;

function renderTab(locale: TestLocale, issueBlockedByContract: boolean) {
  renderWithIntl(
    <BoqTab
      projectId="p1"
      boq={draft}
      canBuild
      canSeeCost={false}
      clientCanOpenOnIssue={false}
      issueBlockedByContract={issueBlockedByContract}
      execution={{ contractId: null, canGenerate: false }}
    />,
    { locale },
  );
}

describe.each<TestLocale>(['en', 'ar-EG'])('BOQ tab draft under a live contract (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const issueButton = () => screen.getByRole('button', { name: at('projects.profile.boq.issue') });

  test('Issue is disabled and the note says why', () => {
    renderTab(locale, true);
    expect((issueButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(at('projects.profile.boq.issueBlockedByContract'))).toBeTruthy();
  });

  test('without a contract Issue is enabled and there is no note', () => {
    renderTab(locale, false);
    expect((issueButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(at('projects.profile.boq.issueBlockedByContract'))).toBeNull();
  });
});
