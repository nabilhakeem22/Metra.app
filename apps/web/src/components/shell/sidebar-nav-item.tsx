'use client';

import type { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import type { NavItem } from './nav-items';
import { ACTIVE_ITEM_STYLE, ITEM_CLASS } from './sidebar-item-styles';
import { signOutAfterPendingWrites } from './sign-out-after-pending-writes';

// One sidebar row: the sign-out form button, a disabled placeholder, or the
// nav link. The parent computes `active` from the pathname and keys this row.
export function SidebarNavItem({
  item,
  active,
  nav,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  nav: ReturnType<typeof useTranslations<'nav'>>;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  // Active state reads via a subtle --brand-tint chip BEHIND the
  // stroke icon (icon stays stroked in currentColor = --brand-ink),
  // not by force-filling the glyph's stroke paths, which looked
  // uneven across different Lucide icons (Slice-2 D3). Every row
  // reserves the same 22px icon box so the label column never shifts.
  const icon = (
    <span
      className={cn(
        'inline-flex size-[22px] shrink-0 items-center justify-center rounded-full',
        active && 'bg-[color:var(--brand-tint)]',
      )}
    >
      <Icon width={17} height={17} aria-hidden />
    </span>
  );

  if (item.action === 'signout') {
    return (
      <form action={signOutAfterPendingWrites}>
        <button
          type="submit"
          className={cn(
            ITEM_CLASS,
            'w-full font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)]',
          )}
        >
          {icon}
          <span className="flex-1 truncate text-start">{nav(item.key)}</span>
        </button>
      </form>
    );
  }

  if (item.disabled || !item.href) {
    return (
      <span
        aria-disabled
        className={cn(
          ITEM_CLASS,
          'cursor-not-allowed font-medium text-[color:var(--text-faint)]',
        )}
      >
        {icon}
        <span className="flex-1 truncate">{nav(item.key)}</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        ITEM_CLASS,
        active
          ? 'font-semibold'
          : 'font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)]',
      )}
      style={active ? ACTIVE_ITEM_STYLE : undefined}
    >
      {icon}
      <span className="flex-1 truncate">{nav(item.key)}</span>
    </Link>
  );
}
