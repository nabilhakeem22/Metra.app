'use client';

import { Pencil } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import { Link } from '@/i18n/routing';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ClientRow } from './types';

const CELL = 'px-4 py-2 text-muted-foreground';
const ACTIVE_PILL =
  'rounded-pill bg-[color:var(--success-tint)] px-2 py-0.5 text-caption text-[color:var(--success)]';
const INACTIVE_PILL = 'rounded-pill bg-muted px-2 py-0.5 text-caption text-muted-foreground';

export interface ClientsTableHandlers {
  onEdit: (client: ClientRow) => void;
  onToggleActive: (client: ClientRow) => void;
}

function ClientRowActions({
  client,
  pending,
  handlers,
}: {
  client: ClientRow;
  pending: boolean;
  handlers: ClientsTableHandlers;
}) {
  const t = useTranslations('clients');
  const tc = useTranslations('common');
  return (
    <td className="px-4 py-2">
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => handlers.onEdit(client)}
          aria-label={t('actions.edit')}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
        <OverflowMenu
          label={tc('moreActions')}
          disabled={pending}
          actions={[
            {
              key: 'active',
              label: t(client.active ? 'actions.deactivate' : 'actions.activate'),
              destructive: client.active,
              onSelect: () => handlers.onToggleActive(client),
            },
          ]}
        />
      </div>
    </td>
  );
}

export function ClientTableRow({
  client,
  canManage,
  pending,
  handlers,
}: {
  client: ClientRow;
  canManage: boolean;
  pending: boolean;
  handlers: ClientsTableHandlers;
}) {
  const t = useTranslations('clients');
  const locale = useLocale();
  const name = pickLocale({ nameAr: client.nameAr, nameEn: client.nameEn }, 'name', locale)
    .value;
  return (
    <tr className="border-b last:border-0 hover:bg-muted/40">
      <td className="px-4 py-2 font-medium">
        <Link href={`/clients/${client.id}`} className="hover:underline">
          {name}
        </Link>
      </td>
      <td className={CELL} dir="auto">
        {client.contactName || '—'}
      </td>
      <td className={CELL}>{t(`types.${client.type}`)}</td>
      {/* Email and phone share one column: they are the same fact (how to reach
          them) and two columns pushed the table wide. */}
      <td className={CELL}>
        <span dir="ltr" className="block">
          {client.email || '—'}
        </span>
        <span dir="ltr" className="block text-caption">
          {client.phone || '—'}
        </span>
      </td>
      <td className={CELL} dir="auto">
        {client.city || '—'}
      </td>
      <td className={`${CELL} tabular-nums`} dir="ltr">
        {client.projectCount}
      </td>
      <td className="px-4 py-2">
        <span className={client.active ? ACTIVE_PILL : INACTIVE_PILL}>
          {t(client.active ? 'status.active' : 'status.inactive')}
        </span>
      </td>
      {canManage && (
        <ClientRowActions client={client} pending={pending} handlers={handlers} />
      )}
    </tr>
  );
}
