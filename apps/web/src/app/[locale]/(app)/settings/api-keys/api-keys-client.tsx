'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import type { ApiKeyListRow } from '@/lib/api-keys/queries';
import { ApiKeysCreateCard } from './api-keys-create-card';
import { ApiKeysRawDialog } from './api-keys-raw-dialog';
import { ApiKeysTable } from './api-keys-table';
import { useApiKeyCreate } from './use-api-key-create';
import { useApiKeyRevoke } from './use-api-key-revoke';

export function ApiKeysClient({ initialKeys }: { initialKeys: ApiKeyListRow[] }) {
  const t = useTranslations('apiKeys');
  const { confirm, dialog } = useConfirm();
  const [keys, setKeys] = useState<ApiKeyListRow[]>(initialKeys);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const creating = useApiKeyCreate((minted, row) => {
    setRawKey(minted);
    setKeys((previous) => [row, ...previous]);
  });
  const { revoke, revoking } = useApiKeyRevoke(confirm, (id) =>
    setKeys((previous) =>
      previous.map((key) => (key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key)),
    ),
  );

  async function copyRaw() {
    if (!rawKey) return;
    try {
      await navigator.clipboard.writeText(rawKey);
      toast({ title: t('copied') });
    } catch {
      toast({ title: t('copyFailed'), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6">
      <ApiKeysCreateCard t={t} creating={creating} />
      <ApiKeysTable t={t} keys={keys} revoke={revoke} revoking={revoking} />
      <ApiKeysRawDialog t={t} rawKey={rawKey} setRawKey={setRawKey} copyRaw={copyRaw} />
      {dialog}
    </div>
  );
}
