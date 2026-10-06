'use client';

import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

export interface OverflowMenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
}

/**
 * The one place a row or a bar keeps its less-used and destructive actions.
 * Destructive actions always render LAST, after a separator, in the danger ink.
 * The menu never performs one itself: the caller's `onSelect` awaits
 * `useConfirm` first, so a stray click can only ever open a question.
 */
export function OverflowMenu({
  label,
  actions,
  disabled = false,
}: {
  /** The trigger's accessible name (`common.moreActions`). */
  label: string;
  actions: OverflowMenuAction[];
  disabled?: boolean;
}) {
  if (actions.length === 0) return null;
  const safe = actions.filter((action) => !action.destructive);
  const destructive = actions.filter((action) => action.destructive);
  const item = (action: OverflowMenuAction) => {
    const Icon = action.icon;
    return (
      <DropdownMenuItem
        key={action.key}
        disabled={action.disabled}
        onSelect={action.onSelect}
        className={cn(action.destructive && 'text-[color:var(--danger)] focus:text-[color:var(--danger)]')}
      >
        {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
        {action.label}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <IconButton type="button" aria-label={label}>
          <MoreHorizontal className="size-4" aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {safe.map(item)}
        {safe.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
