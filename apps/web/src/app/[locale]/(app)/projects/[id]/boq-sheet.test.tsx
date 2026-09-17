import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { CapturedToast } from '@/test/doubles';
import type { BoqDetail } from '@/lib/boqs/queries';
import { formatMoney } from '@/lib/format/money';
import { formatQuantity } from '@/lib/format/number';
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

/**
 * A RENDER COUNTER THAT NEEDS NO INSTRUMENTATION. formatMoney is called exactly
 * once per rendered ROW (the amount cell), once per rendered section header and
 * a fixed handful by the totals block, so counting calls counts renders. The
 * mock delegates to the real formatter, so every other assertion in this file
 * still reads a real formatted figure.
 */
const moneyCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/format/money', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/format/money')>();
  return {
    ...real,
    formatMoney: (value: string | number | null | undefined, locale: string) => {
      moneyCalls.count += 1;
      return real.formatMoney(value, locale);
    },
  };
});

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

/**
 * Wave-5 remediation R2: the read-only figures are formatted INSIDE the branch
 * that renders them. The split hoisted both calls above the `canEdit` branch, so
 * an editable sheet formatted two numbers per row that it then threw away --
 * measured at 2,000 lines: 4,103 formatMoney + 2,000 formatQuantity calls per
 * keystroke, against 2,103 + 0 once the calls went back where main had them.
 *
 * Nothing had ever rendered the read-only sheet, so moving them back could have
 * emptied those cells in silence. This is what stops that.
 */
describe('BoqSheet \u2014 the issued (read-only) sheet still shows its figures', () => {
  test('the quantity and rate cells carry the STORED figures, formatted', () => {
    const view = renderWithIntl(<BoqSheet boq={boqFixture()} canEdit={false} />);

    // No cell inputs at all: an issued sheet is not typed into. (The header's
    // search box is not a cell and stays.)
    expect(view.container.querySelectorAll('input[data-col]')).toHaveLength(0);

    const cells = [...view.container.querySelectorAll('td')].map(
      (cell) => cell.textContent?.trim() ?? '',
    );
    const quantity = formatQuantity('4.0000', 'ar-EG');
    const rate = formatMoney('2500.0000', 'ar-EG');
    expect(quantity).not.toBe('');
    expect(rate).not.toBe('');
    expect(cells).toContain(quantity);
    expect(cells).toContain(rate);
    expect(cells).toContain(formatMoney('10000.0000', 'ar-EG'));
  });
});

/**
 * Wave-5 remediation R3: a keystroke re-renders ONE row, not the sheet.
 *
 * `rowApi` used to be rebuilt every render from two hooks that each returned a
 * new object full of new closures, and `visibleLines` rebuilt every line object
 * on every render, so React.memo on a row could never bail out. Measured on a
 * 2,000-line sheet: 2,103 row-amount formats per keystroke and ~1,200ms; 104 and
 * ~100ms once the identities were stable and the row memoised.
 *
 * The invariant is stated as a RATIO rather than a constant, so a future cell
 * that legitimately formats one more figure does not red this test while a
 * re-render of the whole sheet still does.
 */
describe('BoqSheet \u2014 the cost of one keystroke', () => {
  function wideBoq(lineCount: number): BoqDetail {
    const base = boqFixture();
    const lines = Array.from({ length: lineCount }, (_unused, index) => ({
      ...base.sections[0]!.lines[0]!,
      id: `line-${index}`,
      description: `\u0628\u0646\u062f ${index}`,
    }));
    return { ...base, lineCount, sections: [{ ...base.sections[0]!, lines }] };
  }

  function keystrokeCost(lineCount: number): number {
    const view = renderWithIntl(<BoqSheet boq={wideBoq(lineCount)} canEdit />);
    const cell = view.container.querySelector(
      'input[data-col="description"]',
    ) as HTMLInputElement;
    moneyCalls.count = 0;
    fireEvent.change(cell, { target: { value: 'سقف معلق' } });
    const cost = moneyCalls.count;
    view.unmount();
    return cost;
  }

  test('costs the SAME on a 40-line sheet as on a 10-line one', () => {
    const small = keystrokeCost(10);
    const large = keystrokeCost(40);
    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
  });

  test('and the row being typed in DOES re-render, with its own value', () => {
    const view = renderWithIntl(<BoqSheet boq={wideBoq(3)} canEdit />);
    const cells = [
      ...view.container.querySelectorAll('input[data-col="description"]'),
    ] as HTMLInputElement[];
    fireEvent.change(cells[1]!, { target: { value: 'سقف معلق' } });

    expect(cells[1]!.value).toBe('سقف معلق');
    expect(cells[0]!.value).toBe('بند 0');
    expect(cells[2]!.value).toBe('بند 2');
  });
});
