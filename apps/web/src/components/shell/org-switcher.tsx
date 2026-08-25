'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { Link, useRouter } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { setActiveOrg } from '@/lib/org/actions';

// Structurally identical to UserOrgOption (lib/org/queries) so the layout passes
// rows straight through. Account fields arrive as serialized props — this is a
// 'use client' module and must NOT import any runtime value from @metra/db.
export interface OrgOption {
  orgId: string;
  role: string;
  nameAr: string | null;
  nameEn: string | null;
  accountId: string | null;
  accountNameAr: string | null;
  accountNameEn: string | null;
}

export function OrgSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: OrgOption[];
  activeOrgId: string;
}) {
  const t = useTranslations('org');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const nameOf = (o: OrgOption) =>
    pickLocale(o as unknown as Record<string, unknown>, 'name', locale).value ||
    t('workspaceUnnamed');
  const active = orgs.find((o) => o.orgId === activeOrgId) ?? orgs[0];

  // The account that owns the active workspace, as a static (non-switchable)
  // muted header above the workspace list. Empty when the workspace is not yet
  // linked to an account (pickLocale returns '' with both names null).
  const accountName = active
    ? pickLocale(active as unknown as Record<string, unknown>, 'accountName', locale)
        .value
    : '';

  function switchTo(orgId: string) {
    if (orgId === activeOrgId) return;
    startTransition(async () => {
      const res = await setActiveOrg(orgId);
      if (res.ok) {
        router.refresh();
      } else {
        toast({ title: t('switchError'), variant: 'destructive' });
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isPending}
          aria-label={t('switcherLabel')}
          // Glass FIELD (fill + hairline only — never the .glass blur recipe, to
          // avoid nesting a blurred surface inside the sidebar).
          className="flex w-full items-center justify-between gap-2 rounded-[13px] border px-[10px] py-[8px] transition-colors disabled:opacity-60"
          style={{
            background: 'var(--glass)',
            borderColor: 'var(--glass-hairline)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8)',
          }}
        >
          <span className="truncate text-[13px] font-semibold text-[color:var(--text)]">
            {active ? nameOf(active) : t('workspaceUnnamed')}
          </span>
          <ChevronsUpDown
            className="size-4 shrink-0 text-[color:var(--text-muted)]"
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {accountName && (
          <div className="px-2 py-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('account')}
            </p>
            <p className="truncate text-sm font-medium text-muted-foreground">
              {accountName}
            </p>
          </div>
        )}
        <DropdownMenuLabel>{t('yourWorkspaces')}</DropdownMenuLabel>
        {orgs.map((o) => (
          <DropdownMenuItem
            key={o.orgId}
            onSelect={(e) => {
              e.preventDefault();
              switchTo(o.orgId);
            }}
          >
            <span className="flex-1 truncate">{nameOf(o)}</span>
            {o.orgId === activeOrgId && (
              <Check className="size-4 text-primary" aria-hidden />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding" className="cursor-pointer">
            <Plus className="size-4" aria-hidden />
            {t('createOrJoin')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
