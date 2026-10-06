import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { BoqCostedCopy } from './boq-costed-copy';

const pending = vi.hoisted(() => ({ has: false, order: [] as string[] }));
vi.mock('@/hooks/pending-removals', () => ({
  hasPendingRemovals: () => pending.has,
  flushPendingRemovals: async () => {
    pending.order.push('flush');
    return true;
  },
}));

afterEach(() => {
  pending.has = false;
  pending.order.length = 0;
  vi.restoreAllMocks();
});

function clickCostedCopy() {
  renderWithIntl(<BoqCostedCopy boqId="boq-1" documentNumber="BQ-2026-0001" />, { locale: 'en' });
  const link = screen.getByRole('link', {
    name: messageAt('en', 'projects.profile.boq.costedCopyFor').replace('{documentNumber}', 'BQ-2026-0001'),
  });
  return fireEvent.click(link);
}

describe('the costed copy and a pending line delete', () => {
  test('with a delete pending: the tab opens at once, the delete commits, then the PDF loads', async () => {
    pending.has = true;
    const tab = { opener: {} as unknown, location: { href: 'about:blank' } };
    const open = vi.spyOn(window, 'open').mockImplementation(() => {
      pending.order.push('open');
      return tab as unknown as Window;
    });
    const followed = clickCostedCopy();
    expect(followed).toBe(false);
    await act(async () => {});
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(pending.order).toEqual(['open', 'flush']);
    expect(tab.location.href).toContain('/api/pdf/boq/boq-1?variant=internal');
    expect(tab.opener).toBeNull();
  });

  test('with nothing pending the link opens normally', () => {
    const open = vi.spyOn(window, 'open');
    expect(clickCostedCopy()).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(pending.order).toEqual([]);
  });
});
