'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { TourProvider } from '@/components/onboarding/tour/tour-provider';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/toaster';
import { TOUR_STEPS } from '@/lib/onboarding/tour-steps';
import type { MemberRole } from '@/lib/permissions/roles';
import type { OrgOption } from './org-switcher';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

export interface AppShellProps {
  email?: string;
  role: MemberRole;
  orgs: OrgOption[];
  activeOrgId: string;
  unreadCount: number;
  tourSeen: boolean;
  tourStep: string | null;
  children: ReactNode;
}

export function AppShell({
  email,
  role,
  orgs,
  activeOrgId,
  unreadCount,
  tourSeen,
  tourStep,
  children,
}: AppShellProps) {
  const shell = useTranslations('shell');
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    // The tour provider wraps the whole shell so the "?" menu + checklist can
    // drive it; the coachmark pauses while the mobile drawer is open.
    <TourProvider
      initialSeen={tourSeen}
      initialStep={tourStep}
      steps={TOUR_STEPS}
      paused={drawerOpen}
    >
      {/* Flex row: sidebar sits at the inline-start (right in RTL) with no absolute
          positioning — the layout flips automatically with dir. */}
      <div className="flex min-h-screen bg-background">
        <Sidebar
          className="hidden md:flex"
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          orgs={orgs}
          activeOrgId={activeOrgId}
          role={role}
        />

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent className="p-0">
            <SheetTitle className="sr-only">{shell('menu')}</SheetTitle>
            <Sidebar
              className="w-full border-e-0"
              onNavigate={() => setDrawerOpen(false)}
              orgs={orgs}
              activeOrgId={activeOrgId}
              role={role}
            />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            email={email}
            role={role}
            unreadCount={unreadCount}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>

        <Toaster />
      </div>
    </TourProvider>
  );
}
