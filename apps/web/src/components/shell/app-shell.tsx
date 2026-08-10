'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/toaster';
import type { MemberRole } from '@/lib/permissions/roles';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

export interface AppShellProps {
  email?: string;
  role: MemberRole;
  children: ReactNode;
}

export function AppShell({ email, role, children }: AppShellProps) {
  const shell = useTranslations('shell');
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    // Flex row: sidebar sits at the inline-start (right in RTL) with no absolute
    // positioning — the layout flips automatically with dir.
    <div className="flex min-h-screen bg-background">
      <Sidebar
        className="hidden md:flex"
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="p-0">
          <SheetTitle className="sr-only">{shell('menu')}</SheetTitle>
          <Sidebar
            className="w-full border-e-0"
            onNavigate={() => setDrawerOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          email={email}
          role={role}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>

      <Toaster />
    </div>
  );
}
