'use client';

import { Check, Languages, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
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

const THEME_OPTIONS = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
] as const;

// Autonyms — the language you'll switch TO, in its own script.
const LOCALE_AUTONYM: Record<string, string> = {
  en: 'English',
  'ar-EG': 'العربية',
};

export function UserMenu({
  email,
  role,
}: {
  email?: string;
  role: MemberRole;
}) {
  const nav = useTranslations('nav');
  const shell = useTranslations('shell');
  const roles = useTranslations('roles');
  const th = useTranslations('theme');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const target = locale === 'ar-EG' ? 'en' : 'ar-EG';
  const targetLabel = LOCALE_AUTONYM[target];
  const initial = (email?.trim()?.[0] ?? '?').toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={shell('userMenu')}
          className="inline-flex size-8 items-center justify-center rounded-full text-[12px] font-bold text-white outline-none focus-ring-brand"
          style={{
            background: 'var(--brand-grad)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35)',
          }}
        >
          {initial}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[15rem]">
        {email && (
          <DropdownMenuLabel className="truncate text-foreground">
            {email}
          </DropdownMenuLabel>
        )}
        <DropdownMenuLabel className="font-normal">
          {shell('role')}:{' '}
          <span className="font-medium">{roles(`${role}.label`)}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            router.replace(pathname, { locale: target });
          }}
        >
          <Languages className="size-4" aria-hidden />
          {targetLabel}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {th('label')}
        </DropdownMenuLabel>
        {THEME_OPTIONS.map(({ value, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={(e) => {
              e.preventDefault();
              setTheme(value);
            }}
          >
            <Icon className="size-4" aria-hidden />
            <span className="flex-1">{th(value)}</span>
            {mounted && theme === value && (
              <Check className="size-4 text-primary" aria-hidden />
            )}
          </DropdownMenuItem>
        ))}

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
