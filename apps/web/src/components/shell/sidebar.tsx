'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Wordmark } from '@/components/brand/wordmark';
import { usePathname } from '@/i18n/routing';
import { can } from '@/lib/permissions/can';
import type { MemberRole } from '@/lib/permissions/roles';
import { cn } from '@/lib/utils';
import { NAV_GROUPS } from './nav-items';
import { OrgSwitcher, type OrgOption } from './org-switcher';
import { SectionLabel } from '@/components/ui/section-label';
import { SidebarComingSoon } from './sidebar-coming-soon';
import { SidebarNavItem } from './sidebar-nav-item';

export interface SidebarProps {
  /** Called after a nav link is followed — used to close the mobile drawer. */
  onNavigate?: () => void;
  className?: string;
  orgs?: OrgOption[];
  activeOrgId?: string;
  role?: MemberRole;
}

export function Sidebar({
  onNavigate,
  className,
  orgs,
  activeOrgId,
  role,
}: SidebarProps) {
  const nav = useTranslations('nav');
  const pathname = usePathname();
  const [soonOpen, setSoonOpen] = useState(false);

  return (
    <aside
      className={cn('glass flex h-full flex-col rounded-frame', className)}
      style={{
        inlineSize: 'var(--sidebar-w)',
        flex: 'none',
        padding: '14px',
        gap: '16px',
      }}
    >
      {/* Wordmark row */}
      <div className="flex items-center px-[6px] py-[2px]">
        <Wordmark animate />
      </div>

      {/* Org switcher — reskinned to a glass field pill (see org-switcher.tsx) */}
      {orgs && orgs.length > 0 && activeOrgId && (
        <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
      )}

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.groupKey} className="flex flex-col gap-[3px]">
            {group.labelKey && (
              <SectionLabel as="span" className="px-[11px] pb-1">
                {nav(group.labelKey)}
              </SectionLabel>
            )}

            {group.items
              .filter(
                (item) =>
                  !item.capability || (role && can(role, item.capability, 'read')),
              )
              .map((item) => (
                <SidebarNavItem
                  key={item.key}
                  item={item}
                  active={
                    !!item.href &&
                    (pathname === item.href ||
                      pathname.startsWith(`${item.href}/`))
                  }
                  nav={nav}
                  onNavigate={onNavigate}
                />
              ))}

            {/* Coming-soon disclosure lives at the end of the main group. */}
            {group.groupKey === 'main' && (
              <SidebarComingSoon
                open={soonOpen}
                onToggle={() => setSoonOpen((open) => !open)}
                nav={nav}
              />
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
