'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { ClientTableRow, type ClientsTableHandlers } from './clients-table-row';
import type { ClientRow } from './types';

const COLUMNS = [
  'name',
  'contact',
  'type',
  'contactDetails',
  'city',
  'projects',
  'status',
] as const;

export function ClientsTable({
  clients,
  canManage,
  pending,
  handlers,
}: {
  clients: ClientRow[];
  canManage: boolean;
  pending: boolean;
  handlers: ClientsTableHandlers;
}) {
  const t = useTranslations('clients');
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                {COLUMNS.map((column) => (
                  <th key={column} className="px-4 py-2 text-start font-medium">
                    {t(`table.${column}`)}
                  </th>
                ))}
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <ClientTableRow
                  key={client.id}
                  client={client}
                  canManage={canManage}
                  pending={pending}
                  handlers={handlers}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
