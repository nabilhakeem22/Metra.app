'use client';

import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { ApiKeyListRow } from '@/lib/api-keys/queries';

// Western numerals in both locales (§4.1): ISO slice never emits Arabic-Indic
// digits, unlike a locale-aware date formatter.
function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

type KeyStatus = 'active' | 'revoked' | 'expired';

function statusOf(key: ApiKeyListRow): KeyStatus {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return 'active';
}

// The API-keys list card: table of existing keys with a per-row revoke action.
// All state and the revoke handler live in the parent (ApiKeysClient); this
// child is presentational, driven by the passed rows + callbacks.
export function ApiKeysTable({
  t,
  keys,
  revoke,
  revoking,
}: {
  t: ReturnType<typeof useTranslations<'apiKeys'>>;
  keys: ApiKeyListRow[];
  revoke: (key: ApiKeyListRow) => void;
  revoking: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('listTitle')}</CardTitle>
        <CardDescription>{t('listSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <EmptyState title={t('empty')} description={t('emptyDesc')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-start text-muted-foreground">
                  <th className="py-2 text-start font-medium">
                    {t('columnLabel')}
                  </th>
                  <th className="py-2 text-start font-medium">
                    {t('columnPrefix')}
                  </th>
                  <th className="py-2 text-start font-medium">
                    {t('columnCreated')}
                  </th>
                  <th className="py-2 text-start font-medium">
                    {t('columnLastUsed')}
                  </th>
                  <th className="py-2 text-start font-medium">
                    {t('columnStatus')}
                  </th>
                  <th className="py-2 text-end font-medium">
                    {t('columnActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => {
                  const status = statusOf(key);
                  return (
                    <tr key={key.id} className="border-b last:border-0">
                      <td className="py-2">{key.label}</td>
                      <td className="py-2 font-mono" dir="ltr">
                        {key.prefix}…
                      </td>
                      <td className="py-2 tabular-nums" dir="ltr">
                        {formatDate(key.createdAt)}
                      </td>
                      <td className="py-2 tabular-nums" dir="ltr">
                        {key.lastUsedAt
                          ? formatDate(key.lastUsedAt)
                          : t('neverUsed')}
                      </td>
                      <td className="py-2">{t(`status.${status}`)}</td>
                      <td className="py-2 text-end">
                        {status === 'active' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={revoking}
                            onClick={() => revoke(key)}
                          >
                            {t('revoke')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
