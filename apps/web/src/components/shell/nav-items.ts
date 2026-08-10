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
    items: [
      { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
      { key: 'projects', icon: FolderKanban, disabled: true },
      { key: 'proposals', icon: FileText, disabled: true },
      { key: 'contracts', icon: FileSignature, disabled: true },
      { key: 'costing', icon: Calculator, disabled: true },
      { key: 'invoices', icon: ReceiptText, disabled: true },
    ],
  },
  {
    groupKey: 'support',
    labelKey: 'support',
    items: [
      { key: 'settings', icon: Settings, disabled: true },
      { key: 'help', icon: HelpCircle, disabled: true },
      { key: 'signOut', icon: LogOut, action: 'signout' },
    ],
  },
];
