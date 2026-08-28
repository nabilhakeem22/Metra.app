'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type CSSProperties } from 'react';
import { Wordmark } from '@/components/brand/wordmark';
import { Link, usePathname } from '@/i18n/routing';
import { signOut } from '@/lib/auth/actions';
import { can } from '@/lib/permissions/can';
import type { MemberRole } from '@/lib/permissions/roles';
import { cn } from '@/lib/utils';
import { COMING_SOON_ITEMS, NAV_GROUPS } from './nav-items';
import { OrgSwitcher, type OrgOption } from './org-switcher';

export interface SidebarProps {
  /** Called after a nav link is followed — used to close the mobile drawer. */
  onNavigate?: () => void;
  className?: string;
  orgs?: OrgOption[];
  activeOrgId?: string;
  role?: MemberRole;
}

// The active nav pill: a brand-tinted vertical gradient with a hairline tint
// border. The gradient is a fixed brand wash (reads correctly on both washes);
// the border, text and icon colour track the theme via tokens.
const ACTIVE_ITEM_STYLE: CSSProperties = {
  background:
    'linear-gradient(180deg, rgba(21,122,110,.20), rgba(21,122,110,.16))',
  border: '1px solid var(--brand-tint-border)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)',
  color: 'var(--brand-ink)',
};

// Base geometry shared by every nav row (link, disabled, action, disclosure).
const ITEM_CLASS =
  'group flex items-center gap-[10px] rounded-[13px] px-[11px] py-[9px] text-sm outline-none focus-ring-brand transition-colors motion-reduce:transition-none';

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
      className={cn('glass flex h-full flex-col', className)}
      style={{
        inlineSize: 'var(--sidebar-w)',
        flex: 'none',
        padding: '14px',
        gap: '16px',
      }}
    >
      {/* Wordmark row */}
      <div className="flex items-center px-[6px] py-[2px]">
        <Wordmark />
      </div>

      {/* Org switcher — reskinned to a glass field pill (see org-switcher.tsx) */}
      {orgs && orgs.length > 0 && activeOrgId && (
        <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
      )}

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.groupKey} className="flex flex-col gap-[3px]">
            {group.labelKey && (
              <span
                className="px-[11px] pb-1 text-[11px] font-bold uppercase"
                style={{ letterSpacing: '.04em', color: 'var(--text-faint)' }}
              >
                {nav(group.labelKey)}
              </span>
            )}

            {group.items
              .filter(
                (item) =>
                  !item.capability || (role && can(role, item.capability, 'read')),
              )
              .map((item) => {
                const Icon = item.icon;
                const active =
                  !!item.href &&
                  (pathname === item.href ||
                    pathname.startsWith(`${item.href}/`));

                // Active state reads via a subtle --brand-tint chip BEHIND the
                // stroke icon (icon stays stroked in currentColor = --brand-ink),
                // not by force-filling the glyph's stroke paths — which looked
                // uneven across different Lucide icons (Slice-2 D3). Every row
                // reserves the same 22px icon box so the label column never shifts.
                const icon = (
                  <span
                    className={cn(
                      'inline-flex size-[22px] shrink-0 items-center justify-center rounded-[7px]',
                      active && 'bg-[color:var(--brand-tint)]',
                    )}
                  >
                    <Icon width={17} height={17} aria-hidden />
                  </span>
                );

                if (item.action === 'signout') {
                  return (
                    <form key={item.key} action={signOut}>
                      <button
                        type="submit"
                        className={cn(
                          ITEM_CLASS,
                          'w-full font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)]',
                        )}
                      >
                        {icon}
                        <span className="flex-1 truncate text-start">
                          {nav(item.key)}
                        </span>
                      </button>
                    </form>
                  );
                }

                if (item.disabled || !item.href) {
                  return (
                    <span
                      key={item.key}
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
                    key={item.key}
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
              })}

            {/* Coming-soon disclosure lives at the end of the main group. */}
            {group.groupKey === 'main' && (
              <div className="mt-[3px] flex flex-col gap-[3px]">
                <button
                  type="button"
                  onClick={() => setSoonOpen((open) => !open)}
                  aria-expanded={soonOpen}
                  className={cn(
                    ITEM_CLASS,
                    'w-full font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)]',
                  )}
                >
                  <ChevronRight
                    width={15}
                    height={15}
                    className={cn(
                      'shrink-0 transition-transform motion-reduce:transition-none rtl:-scale-x-100',
                      soonOpen && 'rotate-90',
                    )}
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-start">
                    {nav('comingSoon')}
                  </span>
                </button>

                {soonOpen &&
                  COMING_SOON_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <span
                        key={item.key}
                        aria-disabled
                        className={cn(
                          ITEM_CLASS,
                          'ms-4 cursor-not-allowed font-medium text-[color:var(--text-faint)]',
                        )}
                      >
                        <Icon width={17} height={17} className="shrink-0" aria-hidden />
                        <span className="flex-1 truncate">{nav(item.key)}</span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{
                            background: 'var(--track)',
                            color: 'var(--text-faint)',
                          }}
                        >
                          {nav('soon')}
                        </span>
                      </span>
                    );
                  })}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
