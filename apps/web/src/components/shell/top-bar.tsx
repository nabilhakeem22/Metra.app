'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { HelpMenu } from '@/components/onboarding/help-menu';
import type { MemberRole } from '@/lib/permissions/roles';
import { cn } from '@/lib/utils';
import { LocaleSwitch } from './locale-switch';
import { NotificationBell } from './notification-bell';
import { SegmentedTabs } from './segmented-tabs';
import { UserMenu } from './user-menu';

export interface TopBarProps {
  email?: string;
  role: MemberRole;
  unreadCount: number;
  onOpenDrawer: () => void;
  className?: string;
}

export function TopBar({
  email,
  role,
  unreadCount,
  onOpenDrawer,
  className,
}: TopBarProps) {
  const shell = useTranslations('shell');

  return (
    <header
      className={cn('glass flex items-center gap-2', className)}
      // .glass sets --r-panel; the bar uses the slightly tighter --r-bar.
      style={{ borderRadius: 'var(--r-bar)', padding: '10px 16px' }}
    >
      {/* Hamburger opens the sidebar drawer below lg; the fixed slab replaces it
          at lg+. Glass icon button (fill + hairline only — no nested blur). */}
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label={shell('menu')}
        className="inline-flex size-[34px] items-center justify-center rounded-[11px] border text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text)] lg:hidden"
        style={{
          background: 'var(--glass)',
          borderColor: 'var(--glass-hairline)',
        }}
      >
        <Menu width={17} height={17} aria-hidden />
      </button>

      <div className="hidden sm:block">
        <SegmentedTabs />
      </div>

      <div
        className="flex items-center gap-[6px]"
        style={{ marginInlineStart: 'auto' }}
      >
        <NotificationBell unreadCount={unreadCount} />
        <HelpMenu />
        <LocaleSwitch />
        <UserMenu email={email} role={role} />
      </div>
    </header>
  );
}
