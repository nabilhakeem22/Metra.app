import { afterEach, describe, expect, test } from 'vitest';
import { focusNextInColumn } from './boq-sheet-focus';

// Named .test.tsx, not .test.ts, because it touches `document` — in this suite
// the extension is what selects happy-dom, and a DOM test named .test.ts dies in
// the node environment.

function buildSheet(): { table: HTMLTableElement; cells: HTMLInputElement[] } {
  const table = document.createElement('table');
  const body = document.createElement('tbody');
  const cells: HTMLInputElement[] = [];
  for (const value of ['1000', '2000', '3000']) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.setAttribute('data-col', 'unitPrice');
    input.value = value;
    cell.appendChild(input);
    row.appendChild(cell);
    body.appendChild(row);
    cells.push(input);
  }
  table.appendChild(body);
  document.body.appendChild(table);
  return { table, cells };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusNextInColumn', () => {
  test('Enter from the first rate focuses the second', () => {
    const { table, cells } = buildSheet();
    expect(focusNextInColumn(table, 'unitPrice', cells[0]!)).toBe(cells[1]);
    expect(document.activeElement).toBe(cells[1]);
  });

  test('walking the whole column reaches the last cell', () => {
    const { table, cells } = buildSheet();
    focusNextInColumn(table, 'unitPrice', cells[0]!);
    expect(focusNextInColumn(table, 'unitPrice', cells[1]!)).toBe(cells[2]);
  });

  test('from the LAST cell it focuses nothing and throws nothing', () => {
    const { table, cells } = buildSheet();
    cells[2]!.focus();
    expect(() => focusNextInColumn(table, 'unitPrice', cells[2]!)).not.toThrow();
    expect(focusNextInColumn(table, 'unitPrice', cells[2]!)).toBeNull();
    expect(document.activeElement).toBe(cells[2]);
  });

  test('a column with no cells of its own moves nothing', () => {
    const { table, cells } = buildSheet();
    expect(focusNextInColumn(table, 'qty', cells[0]!)).toBeNull();
  });

  test('a null table (the ref before mount) is a no-op, not a crash', () => {
    const { cells } = buildSheet();
    expect(focusNextInColumn(null, 'unitPrice', cells[0]!)).toBeNull();
  });
});
