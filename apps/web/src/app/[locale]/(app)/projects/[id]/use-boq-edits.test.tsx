import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { useBoqEdits, type BoqEditsApi } from './use-boq-edits';

afterEach(cleanup);

// W5 R6: "all saved" showed while a second write to the same line was still in
// flight. `savingIds` was a Set, so two blurs on one row marked it saving twice
// and unmarked it twice — and the FIRST unmark deleted the id outright. The
// footer went green and the row's spinner stopped with a write still on the wire.

/** The hook as the sheet mounts it, with its api and every render exposed. */
function editsHarness() {
  const renders: BoqEditsApi[] = [];
  function Probe() {
    const api = useBoqEdits();
    renders.push(api);
    return null;
  }
  render(<Probe />);
  return {
    renders,
    latest: () => renders[renders.length - 1]!,
  };
}

describe('useBoqEdits — saves in flight are COUNTED, not a membership set', () => {
  it('keeps a row saving until every write on it has reported back', () => {
    const edits = editsHarness();

    act(() => {
      edits.latest().markSaving('line-1', true);
      edits.latest().markSaving('line-1', true);
    });
    expect(edits.latest().savingIds.has('line-1')).toBe(true);
    expect(edits.latest().savingCount).toBe(1);

    act(() => {
      edits.latest().markSaving('line-1', false);
    });
    // THE DEFECT: this used to be false, with a write still outstanding.
    expect(edits.latest().savingIds.has('line-1')).toBe(true);
    expect(edits.latest().savingCount).toBe(1);

    act(() => {
      edits.latest().markSaving('line-1', false);
    });
    expect(edits.latest().savingIds.has('line-1')).toBe(false);
    expect(edits.latest().savingCount).toBe(0);
  });

  it('counts ROWS mid-save, not writes, so the footer light means what it says', () => {
    const edits = editsHarness();
    act(() => {
      edits.latest().markSaving('line-1', true);
      edits.latest().markSaving('line-1', true);
      edits.latest().markSaving('line-2', true);
    });
    expect(edits.latest().savingCount).toBe(2);
  });

  it('clamps at zero, so an unbalanced unmark cannot strand a row as saving', () => {
    const edits = editsHarness();
    act(() => {
      edits.latest().markSaving('line-1', false);
    });
    expect(edits.latest().savingCount).toBe(0);
    act(() => {
      edits.latest().markSaving('line-1', true);
    });
    expect(edits.latest().savingIds.has('line-1')).toBe(true);
  });

  it('hands out the SAME savingIds object while only cells change', () => {
    // `savingIds` is derived from the counts now, and a fresh Set per render
    // would give every row a new prop and undo the `React.memo` this hook exists
    // to make work — one keystroke re-rendering a 2,000-line sheet.
    const edits = editsHarness();
    const before = edits.latest().savingIds;
    act(() => {
      edits.latest().setCell('line-1', 'qty', '12');
    });
    expect(edits.latest().cells['line-1']?.qty).toBe('12');
    expect(edits.latest().savingIds).toBe(before);
  });
});
