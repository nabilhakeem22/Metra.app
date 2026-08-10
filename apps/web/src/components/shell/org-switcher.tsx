'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
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

export interface OrgOption {
  orgId: string;
  role: string;
  nameAr: string | null;
  nameEn: string | null;
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
    t('unnamed');
  const active = orgs.find((o) => o.orgId === activeOrgId) ?? orgs[0];

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
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between gap-2"
          disabled={isPending}
          aria-label={t('switcherLabel')}
        >
          <span className="truncate">{active ? nameOf(active) : t('unnamed')}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{t('yourCompanies')}</DropdownMenuLabel>
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
