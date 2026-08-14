'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Wordmark } from '@/components/brand/wordmark';
import { HelpMenu } from '@/components/onboarding/help-menu';
import { Button } from '@/components/ui/button';
import type { MemberRole } from '@/lib/permissions/roles';
import { cn } from '@/lib/utils';
import { LocaleSwitch } from './locale-switch';
import { NotificationBell } from './notification-bell';
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
      className={cn(
        'flex items-center gap-3 border-b bg-card/80 px-4 py-3 backdrop-blur',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenDrawer}
        aria-label={shell('menu')}
      >
        <Menu className="size-5" aria-hidden />
      </Button>

      {/* Brand on mobile (the sidebar is hidden there); no dead search control. */}
      <div className="md:hidden">
        <Wordmark size="sm" />
      </div>

      <div className="ms-auto flex items-center gap-1">
        <NotificationBell unreadCount={unreadCount} />
        <HelpMenu />
        <LocaleSwitch />
        <UserMenu email={email} role={role} />
      </div>
    </header>
  );
}
