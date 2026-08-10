'use client';

import { ChevronRight, PanelLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Wordmark } from '@/components/brand/wordmark';
import { Button } from '@/components/ui/button';
import { Link, usePathname } from '@/i18n/routing';
import { signOut } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';
import { COMING_SOON_ITEMS, NAV_GROUPS } from './nav-items';
import { OrgSwitcher, type OrgOption } from './org-switcher';

export interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  className?: string;
  orgs?: OrgOption[];
  activeOrgId?: string;
}

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
  onNavigate,
  className,
  orgs,
  activeOrgId,
}: SidebarProps) {
  const nav = useTranslations('nav');
  const shell = useTranslations('shell');
  const pathname = usePathname();
  const [soonOpen, setSoonOpen] = useState(false);

  const itemBase =
    'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors';

  return (
    <aside
      className={cn(
        'flex h-full flex-col gap-4 border-e bg-card p-3',
        collapsed ? 'w-16' : 'w-64',
        className,
      )}
    >
      <div className={cn('flex items-center px-2 py-1', collapsed && 'justify-center')}>
        {collapsed ? (
          <span aria-hidden className="size-2.5 rounded-full bg-brand" />
        ) : (
          <Wordmark size="sm" />
        )}
      </div>

      {!collapsed && orgs && orgs.length > 0 && activeOrgId && (
        <div className="px-1">
          <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.groupKey} className="flex flex-col gap-1">
            {!collapsed && group.labelKey && (
              <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {nav(group.labelKey)}
              </p>
            )}

            {group.items.map((item) => {
              const Icon = item.icon;
              const active =
                !!item.href &&
                (pathname === item.href || pathname.startsWith(`${item.href}/`));

              const content = (
                <>
                  <Icon className="size-5 shrink-0" aria-hidden />
                  {!collapsed && (
                    <span className="flex-1 truncate">{nav(item.key)}</span>
                  )}
                  {!collapsed && item.disabled && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {nav('soon')}
                    </span>
                  )}
                </>
              );

              if (item.action === 'signout') {
                return (
                  <form key={item.key} action={signOut}>
                    <button
                      type="submit"
                      title={collapsed ? nav(item.key) : undefined}
                      className={cn(
                        itemBase,
                        'w-full text-muted-foreground hover:bg-muted hover:text-foreground',
                        collapsed && 'justify-center',
                      )}
                    >
                      {content}
                    </button>
                  </form>
                );
              }

              if (item.disabled || !item.href) {
                return (
                  <span
                    key={item.key}
                    aria-disabled
                    title={collapsed ? nav(item.key) : undefined}
                    className={cn(
                      itemBase,
                      'cursor-not-allowed text-muted-foreground/60',
                      collapsed && 'justify-center',
                    )}
                  >
                    {content}
                  </span>
                );
              }

              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? nav(item.key) : undefined}
                  className={cn(
                    itemBase,
                    'relative',
                    active
                      ? // copper trace bar at the inline-start marks the active item
                        'bg-primary/10 text-primary before:absolute before:inset-y-1.5 before:start-0 before:w-[3px] before:rounded-full before:bg-brand'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    collapsed && 'justify-center',
                  )}
                >
                  {content}
                </Link>
              );
            })}

            {group.groupKey === 'main' && !collapsed && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => setSoonOpen((o) => !o)}
                  aria-expanded={soonOpen}
                  className={cn(
                    itemBase,
                    'w-full text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <ChevronRight
                    className={cn(
                      'size-4 shrink-0 transition-transform motion-reduce:transition-none',
                      soonOpen && 'rotate-90 rtl:-rotate-90',
                    )}
                    aria-hidden
                  />
                  <span className="flex-1 text-start">{nav('comingSoon')}</span>
                </button>

                {soonOpen && (
                  <div className="mt-1 flex flex-col gap-1">
                    {COMING_SOON_ITEMS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <span
                          key={item.key}
                          aria-disabled
                          className={cn(
                            itemBase,
                            'ms-4 cursor-not-allowed text-muted-foreground/50',
                          )}
                        >
                          <Icon className="size-5 shrink-0" aria-hidden />
                          <span className="flex-1 truncate">
                            {nav(item.key)}
                          </span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {nav('soon')}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </nav>

      {onToggleCollapse && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onToggleCollapse}
          aria-label={shell('collapse')}
          className={cn('hidden md:flex', collapsed && 'justify-center')}
        >
          <PanelLeft className="size-4" aria-hidden />
          {!collapsed && <span>{shell('collapse')}</span>}
        </Button>
      )}
    </aside>
  );
}
