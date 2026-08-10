import {
  Calculator,
  FileSignature,
  FileText,
  FolderKanban,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** Maps to a `nav.<key>` message. */
  key: string;
  href?: string;
  icon: LucideIcon;
  disabled?: boolean;
  /** Non-link actions (rendered as a form button by the caller). */
  action?: 'signout';
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
    items: [{ key: 'dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    groupKey: 'support',
    labelKey: 'support',
    items: [
      { key: 'team', href: '/team', icon: Users },
      { key: 'settings', href: '/settings', icon: Settings },
      { key: 'help', icon: HelpCircle, disabled: true },
      { key: 'signOut', icon: LogOut, action: 'signout' },
    ],
  },
];

/**
 * The spine modules (P1) — collapsed behind a single "Coming soon" disclosure so
 * the shell isn't 5 always-visible dead rows.
 */
export const COMING_SOON_ITEMS: NavItem[] = [
  { key: 'projects', icon: FolderKanban, disabled: true },
  { key: 'proposals', icon: FileText, disabled: true },
  { key: 'contracts', icon: FileSignature, disabled: true },
  { key: 'costing', icon: Calculator, disabled: true },
  { key: 'invoices', icon: ReceiptText, disabled: true },
];
