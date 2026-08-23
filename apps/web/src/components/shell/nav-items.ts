import {
  BookText,
  Building2,
  Calculator,
  Compass,
  FileSignature,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Capability } from '@/lib/permissions/roles';

export interface NavItem {
  /** Maps to a `nav.<key>` message. */
  key: string;
  href?: string;
  icon: LucideIcon;
  disabled?: boolean;
  /** Non-link actions (rendered as a form button by the caller). */
  action?: 'signout';
  /** If set, the item shows only when the role has read on this capability. */
  capability?: Capability;
}

export interface NavGroup {
  groupKey: string;
  /** Optional `nav.<labelKey>` heading; omitted groups render no heading. */
  labelKey?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'main',
    items: [
      { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
      { key: 'clients', href: '/clients', icon: Building2, capability: 'clients' },
      {
        key: 'projects',
        href: '/projects',
        icon: FolderKanban,
        capability: 'projects',
      },
      {
        key: 'priceBook',
        href: '/price-book',
        icon: BookText,
        capability: 'price_book',
      },
      {
        key: 'proposals',
        href: '/proposals',
        icon: FileText,
        capability: 'proposals_build',
      },
      {
        key: 'contracts',
        href: '/contracts',
        icon: FileSignature,
        capability: 'contracts_generate',
      },
      {
        key: 'engagements',
        href: '/engagements',
        icon: Compass,
        capability: 'engagements_design',
      },
    ],
  },
  {
    groupKey: 'support',
    labelKey: 'support',
    items: [
      { key: 'team', href: '/team', icon: Users },
      { key: 'settings', href: '/settings', icon: Settings },
      { key: 'signOut', icon: LogOut, action: 'signout' },
    ],
  },
];

/**
 * The spine modules (P1) — collapsed behind a single "Coming soon" disclosure so
 * the shell isn't 5 always-visible dead rows.
 */
export const COMING_SOON_ITEMS: NavItem[] = [
  { key: 'costing', icon: Calculator, disabled: true },
  { key: 'invoices', icon: ReceiptText, disabled: true },
];
