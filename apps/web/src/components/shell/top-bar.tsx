'use client';

import { Menu, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MemberRole } from '@/lib/permissions/roles';
import { cn } from '@/lib/utils';
import { LocaleSwitch } from './locale-switch';
import { UserMenu } from './user-menu';

export interface TopBarProps {
  email?: string;
  role: MemberRole;
  onOpenDrawer: () => void;
  className?: string;
}

export function TopBar({ email, role, onOpenDrawer, className }: TopBarProps) {
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

      {/* Decorative placeholder — no live search in P0 (honest empty). */}
      <div className="relative hidden max-w-sm flex-1 sm:block">
        <Search
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          disabled
          placeholder={shell('search')}
          aria-label={shell('search')}
          className="ps-9"
        />
      </div>

      <div className="ms-auto flex items-center gap-1">
        <LocaleSwitch />
        <UserMenu email={email} role={role} />
      </div>
    </header>
  );
}
