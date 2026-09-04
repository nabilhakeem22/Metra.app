'use client';

import { useTranslations } from 'next-intl';
import type { FeedItem } from '@/components/notifications/feed-item';
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
  /** Recent notifications for the bell's dropdown. */
  notifications: FeedItem[];
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
  notifications,
  tourSeen,
  tourStep,
  children,
}: AppShellProps) {
  const shell = useTranslations('shell');
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
      {/* Glass shell: the root paints --bg-base with the 3-stop radial --bg-wash
          on an absolute inset-0 layer BEHIND a relative content layer — that's
          what the two floating glass slabs refract. Fixed viewport chrome; the
          page content scrolls inside the main column. */}
      <div
        className="relative h-screen overflow-hidden"
        style={{ background: 'var(--bg-base)' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--bg-wash)' }}
        />

        {/* Content layer: 14px inset + gap so every panel floats — nothing is
            edge-to-edge. Flex row flips automatically with dir (sidebar on the
            inline-end/right in RTL). */}
        <div
          className="relative flex h-full"
          style={{ padding: '14px', gap: '14px' }}
        >
          {/* Fixed slab at lg+ */}
          <Sidebar
            className="hidden lg:flex"
            orgs={orgs}
            activeOrgId={activeOrgId}
            role={role}
          />

          {/* Slide-in drawer below lg — the glass slab lives inside a transparent
              off-canvas sheet so it reads as the same floating panel. */}
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent className="w-[232px] border-0 bg-transparent p-0 shadow-none">
              <SheetTitle className="sr-only">{shell('menu')}</SheetTitle>
              <Sidebar
                onNavigate={() => setDrawerOpen(false)}
                orgs={orgs}
                activeOrgId={activeOrgId}
                role={role}
              />
            </SheetContent>
          </Sheet>

          <div
            className="flex min-w-0 flex-1 flex-col"
            style={{ gap: '14px' }}
          >
            <TopBar
              email={email}
              role={role}
              unreadCount={unreadCount}
              notifications={notifications}
              onOpenDrawer={() => setDrawerOpen(true)}
            />
            <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
          </div>

          <Toaster />
        </div>
      </div>
    </TourProvider>
  );
}
