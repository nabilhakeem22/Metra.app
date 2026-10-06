import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Trash2 } from 'lucide-react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { openMenu } from '@/test/open-menu';
import { OverflowMenu, type OverflowMenuAction } from './overflow-menu';

afterEach(cleanup);

const actions = (onDelete = vi.fn()): OverflowMenuAction[] => [
  { key: 'delete', label: 'Delete', onSelect: onDelete, destructive: true, icon: Trash2 },
  { key: 'edit', label: 'Edit', onSelect: vi.fn() },
  { key: 'primary', label: 'Set primary', onSelect: vi.fn() },
];

describe('OverflowMenu', () => {
  test('renders nothing for an empty list', () => {
    const { container } = render(<OverflowMenu label="More actions" actions={[]} />);
    expect(container.innerHTML).toBe('');
  });

  test('the trigger is an icon button named by its aria-label', () => {
    render(<OverflowMenu label="More actions" actions={actions()} />);
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
  });

  test('destructive actions come last, after the separator, in the danger ink', () => {
    render(<OverflowMenu label="More actions" actions={actions()} />);
    openMenu('More actions');
    const menu = screen.getByRole('menu');
    const children = [...menu.children];
    const labels = children.map((child) =>
      child.getAttribute('role') === 'separator' ? '|' : child.textContent,
    );
    expect(labels).toEqual(['Edit', 'Set primary', '|', 'Delete']);
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
    expect(deleteItem.className).toContain('text-[color:var(--danger)]');
    expect(screen.getByRole('menuitem', { name: 'Edit' }).className).not.toContain('danger');
  });

  test('selecting an item calls its onSelect', () => {
    const onDelete = vi.fn();
    render(<OverflowMenu label="More actions" actions={actions(onDelete)} />);
    openMenu('More actions');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
