import { describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { BudgetBadge } from '@/lib/engagements/budget-badge';
import { ENGAGEMENT_TABS } from './tabs';
import {
  EngagementTabStrip,
  type EngagementTabStripProps,
} from './engagement-tab-strip';

const ar = (path: string) => messageAt('ar-EG', path);

const DRAFT_BADGE = ar('engagements.offPlan.budgetDraftBadge');
const AWAITING_BADGE = ar('engagements.offPlan.budgetAwaitingAckBadge');

function renderStrip(overrides: Partial<EngagementTabStripProps> = {}) {
  const onSelect = vi.fn();
  const result = renderWithIntl(
    <EngagementTabStrip
      tab="files"
      onSelect={onSelect}
      paymentClaimCount={0}
      awaitingReplyCount={0}
      budget={null}
      pending={false}
      {...overrides}
    />,
  );
  return { ...result, onSelect };
}

function tabButton(tab: (typeof ENGAGEMENT_TABS)[number]): HTMLElement {
  return screen.getByRole('tab', { name: new RegExp(ar(`engagements.panels.${tab}`)) });
}

/**
 * Wave 2's ROM badge, RENDERED. The rule is tested in budget-badge.test.ts; this
 * proves the strip reads it and puts the right catalogue string on the right tab.
 */
describe('EngagementTabStrip — the budget badge', () => {
  test.each<[BudgetBadge, string]>([
    ['draft', DRAFT_BADGE],
    ['awaitingAck', AWAITING_BADGE],
  ])('budget=%s badges the Budget tab with its own string', (budget, expected) => {
    renderStrip({ budget });
    expect(tabButton('budget').textContent).toContain(expected);
  });

  test('budget=draft does NOT show the awaiting string, and vice versa', () => {
    const { unmount } = renderStrip({ budget: 'draft' });
    expect(screen.queryByText(AWAITING_BADGE)).toBeNull();
    unmount();
    renderStrip({ budget: 'awaitingAck' });
    expect(screen.queryByText(DRAFT_BADGE)).toBeNull();
  });

  test('budget=null shows NEITHER string anywhere in the strip', () => {
    renderStrip({ budget: null });
    expect(screen.queryByText(DRAFT_BADGE)).toBeNull();
    expect(screen.queryByText(AWAITING_BADGE)).toBeNull();
  });

  test('the badge lands on Budget and on no other tab', () => {
    renderStrip({ budget: 'draft' });
    for (const tab of ENGAGEMENT_TABS) {
      if (tab === 'budget') continue;
      expect(tabButton(tab).textContent).not.toContain(DRAFT_BADGE);
    }
  });
});

describe('EngagementTabStrip — the count badges', () => {
  test('a paymentClaimCount of 2 badges Payments and NOT Files', () => {
    renderStrip({ paymentClaimCount: 2 });
    const badge = ar('engagements.paymentsBadge').replace('{n}', '2');
    expect(tabButton('payments').textContent).toContain(badge);
    expect(tabButton('files').textContent).not.toContain(badge);
  });

  test('awaitingReplyCount badges Files', () => {
    renderStrip({ awaitingReplyCount: 3 });
    expect(tabButton('files').textContent).toContain(
      ar('engagements.paymentsBadge').replace('{n}', '3'),
    );
  });

  test('a count of zero raises no badge at all', () => {
    renderStrip({ paymentClaimCount: 0, awaitingReplyCount: 0 });
    expect(tabButton('payments').textContent).toBe(ar('engagements.panels.payments'));
  });
});

describe('EngagementTabStrip — selection and the in-flight lock', () => {
  test('the current tab is the selected one and the others are not', () => {
    renderStrip({ tab: 'timeline' });
    expect(tabButton('timeline').getAttribute('aria-selected')).toBe('true');
    expect(tabButton('files').getAttribute('aria-selected')).toBe('false');
  });

  test('clicking a tab reports THAT tab', () => {
    const { onSelect } = renderStrip();
    fireEvent.click(tabButton('changeOrders'));
    expect(onSelect).toHaveBeenCalledWith('changeOrders');
  });

  // Switching tabs unmounts the open panel under an answer that has not arrived;
  // a studio who cannot see the form they submitted cannot tell what happened to
  // it. (The key survives the unmount — it is held in the store, not the panel.)
  test('pending disables ALL FIVE tabs', () => {
    renderStrip({ pending: true });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) expect((tab as HTMLButtonElement).disabled).toBe(true);
  });

  test('a disabled tab does not report a selection', () => {
    const { onSelect } = renderStrip({ pending: true });
    fireEvent.click(tabButton('payments'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
