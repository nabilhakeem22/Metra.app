'use client';

import { ChevronDown, Languages, LogOut } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePathname, useRouter } from '@/i18n/routing';
import { signOut } from '@/lib/auth/actions';
import type { MemberRole } from '@/lib/permissions/roles';

export function UserMenu({
  email,
  role,
}: {
  email?: string;
  role: MemberRole;
}) {
  const nav = useTranslations('nav');
  const shell = useTranslations('shell');
  const home = useTranslations('home');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const target = locale === 'ar-EG' ? 'en' : 'ar-EG';
  const initial = (email?.trim()?.[0] ?? '?').toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          aria-label={shell('userMenu')}
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {initial}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[14rem]">
        {email && (
          <DropdownMenuLabel className="truncate text-foreground">
            {email}
          </DropdownMenuLabel>
        )}
        <DropdownMenuLabel className="font-normal">
          {shell('role')}: <span className="font-medium">{role}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            router.replace(pathname, { locale: target });
          }}
        >
          <Languages className="size-4" aria-hidden />
          {home('localeName')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <form action={signOut} className="w-full">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full text-destructive">
              <LogOut className="size-4" aria-hidden />
              {nav('signOut')}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
