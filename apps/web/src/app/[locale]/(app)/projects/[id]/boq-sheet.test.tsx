import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { CapturedToast } from '@/test/doubles';
import type { BoqDetail } from '@/lib/boqs/queries';
import { BoqSheet } from './boq-sheet';

// @/lib/boqs/actions is 'use server' — it reaches requireOrg and the whole
// server-only stack. The unit config deliberately does NOT stub server-only, so
// an unmocked action module throws on import. That is the harness telling the
// truth, not a bug to work around.
const actions = vi.hoisted(() => ({
  addBoqLine: vi.fn(),
  addBoqSection: vi.fn(),
  deleteBoqLine: vi.fn(),
  setBoqDiscount: vi.fn(),
  updateBoqLine: vi.fn(),
}));
vi.mock('@/lib/boqs/actions', () => actions);

const toasts = vi.hoisted(() => [] as CapturedToast[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: CapturedToast) => {
    toasts.push(raised);
  },
}));

const ar = (path: string) => messageAt('ar-EG', path);

const LINE_ID = 'line-1';

function boqFixture(): BoqDetail {
  return {
    id: 'boq-1',
    number: 2,
    title: 'BOQ',
    status: 'draft',
    source: 'manual',
    currency: 'EGP',
    discountPct: '5.0000',
    subtotal: '10000.0000',
    discountAmount: '500.0000',
    total: '9500.0000',
    lineCount: 1,
    sections: [
      {
        id: 'section-1',
        title: 'أعمال الجبس',
        sectionSubtotal: '10000.0000',
        lines: [
          {
            id: LINE_ID,
            itemCode: '2.03.1',
            description: 'سقف جبسوم بورد',
            unit: 'sqm',
            qty: '4.0000',
            unitPrice: '2500.0000',
            discountPct: '0.0000',
            lineTotal: '10000.0000',
            provisional: false,
          },
        ],
      },
    ],
  };
}

function renderSheet() {
  return renderWithIntl(<BoqSheet boq={boqFixture()} canEdit />);
}

function descriptionCell(): HTMLInputElement {
  return screen.getByLabelText(ar('projects.profile.boq.col.description')) as HTMLInputElement;
}

/** Type into the description cell and blur it — the one write path in this sheet. */
function typeDescriptionAndBlur(text: string): void {
  const cell = descriptionCell();
  fireEvent.change(cell, { target: { value: text } });
  fireEvent.blur(cell);
}

beforeEach(() => {
  toasts.length = 0;
  for (const action of Object.values(actions)) action.mockReset();
});

/**
 * Wave 3's AC10/AC11: every coded server refusal on this sheet resolves through
 * the SHARED errors catalogue. This screen used to map eight codes by hand and
 * send everything else to "That change was not saved", which is what an
 * over-length description looked like to the studio.
 *
 * Nothing has ever rendered it. This file is the safety net for the split that
 * follows, and no commit in that split may edit it.
 */
describe('BoqSheet — the refusal paths', () => {
  test('typing a description and blurring writes that ONE line, ONCE', async () => {
    actions.updateBoqLine.mockResolvedValue({ ok: true });
    renderSheet();

    typeDescriptionAndBlur('سقف معلق');

    await waitFor(() => {
      expect(actions.updateBoqLine).toHaveBeenCalledTimes(1);
    });
    expect(actions.updateBoqLine).toHaveBeenCalledWith({
      lineId: LINE_ID,
      patch: { description: 'سقف معلق' },
    });
    expect(toasts).toHaveLength(0);
  });

  test('description_too_long toasts THAT key, not errors.generic', async () => {
    actions.updateBoqLine.mockResolvedValue({
      ok: false,
      error: 'description_too_long',
    });
    renderSheet();

    typeDescriptionAndBlur('x'.repeat(600));

    await waitFor(() => {
      expect(toasts).toHaveLength(1);
    });
    expect(toasts[0]).toEqual({
      title: ar('errors.description_too_long'),
      variant: 'destructive',
    });
    expect(toasts[0]?.title).not.toBe(ar('errors.generic'));
    expect(toasts[0]?.title).not.toBe(ar('projects.profile.boq.saveFailed'));
  });

  test('a refusal carrying NO code falls back to errors.generic', async () => {
    actions.updateBoqLine.mockResolvedValue({ ok: false });
    renderSheet();

    typeDescriptionAndBlur('مظلة');

    await waitFor(() => {
      expect(toasts).toHaveLength(1);
    });
    expect(toasts[0]).toEqual({ title: ar('errors.generic'), variant: 'destructive' });
  });

  test('a THROWN action toasts projects.profile.boq.saveFailed, not a coded refusal', async () => {
    actions.updateBoqLine.mockRejectedValue(new Error('network died'));
    renderSheet();

    typeDescriptionAndBlur('كرانيش');

    await waitFor(() => {
      expect(toasts).toHaveLength(1);
    });
    expect(toasts[0]).toEqual({
      title: ar('projects.profile.boq.saveFailed'),
      variant: 'destructive',
    });
  });

  test('AFTER A REFUSAL THE TYPED VALUE IS STILL IN THE INPUT', async () => {
    actions.updateBoqLine.mockResolvedValue({
      ok: false,
      error: 'description_too_long',
    });
    renderSheet();

    typeDescriptionAndBlur('نص طويل جدا');

    await waitFor(() => {
      expect(toasts).toHaveLength(1);
    });
    // The comment at boq-sheet.tsx:166-168 promises exactly this: reverting to the
    // stored value would throw away what the studio typed and leave them guessing
    // which cell was wrong. Nothing has ever checked it.
    expect(descriptionCell().value).toBe('نص طويل جدا');
  });

  test('a refused addBoqSection toasts section_name_too_long', async () => {
    actions.addBoqSection.mockResolvedValue({
      ok: false,
      error: 'section_name_too_long',
    });
    renderSheet();

    fireEvent.click(
      screen.getByRole('button', { name: ar('projects.profile.boq.addSection') }),
    );

    await waitFor(() => {
      expect(toasts).toHaveLength(1);
    });
    expect(toasts[0]).toEqual({
      title: ar('errors.section_name_too_long'),
      variant: 'destructive',
    });
    expect(actions.addBoqSection).toHaveBeenCalledWith({
      boqId: 'boq-1',
      title: ar('projects.profile.boq.newSection'),
    });
  });

  test('blurring an UNCHANGED cell issues no call at all', async () => {
    renderSheet();
    const cell = descriptionCell();

    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: 'حاجة تانية' } });
    fireEvent.change(cell, { target: { value: 'سقف جبسوم بورد' } });
    fireEvent.blur(cell);

    await waitFor(() => {
      expect(cell.value).toBe('سقف جبسوم بورد');
    });
    expect(actions.updateBoqLine).not.toHaveBeenCalled();
    expect(toasts).toHaveLength(0);
  });
});
