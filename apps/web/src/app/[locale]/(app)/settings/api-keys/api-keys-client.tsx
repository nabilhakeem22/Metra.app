'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { mintApiKey, revokeApiKey } from '@/lib/api-keys/actions';
import type { ApiKeyListRow } from '@/lib/api-keys/queries';
import { ApiKeysCreateCard } from './api-keys-create-card';
import { ApiKeysRawDialog } from './api-keys-raw-dialog';
import { ApiKeysTable } from './api-keys-table';

export function ApiKeysClient({
  initialKeys,
}: {
  initialKeys: ApiKeyListRow[];
}) {
  const t = useTranslations('apiKeys');
  const te = useTranslations('errors');
  const { confirm, dialog } = useConfirm();
  const [keys, setKeys] = useState<ApiKeyListRow[]>(initialKeys);
  const [label, setLabel] = useState('');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [minting, startMint] = useTransition();
  const [revoking, startRevoke] = useTransition();

  const errorMessage = (code?: ActionCode) => resolveActionError(code, te);

  function create() {
    const trimmed = label.trim();
    if (!trimmed) return;
    startMint(async () => {
      const res = await mintApiKey({ label: trimmed });
      if (res.ok && res.data) {
        setRawKey(res.data.rawKey);
        setKeys((prev) => [
          {
            id: res.data!.id,
            label: trimmed,
            prefix: res.data!.prefix,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            revokedAt: null,
            expiresAt: null,
          },
          ...prev,
        ]);
        setLabel('');
      } else {
        toast({ title: errorMessage(res.error), variant: 'destructive' });
      }
    });
  }

  function revoke(key: ApiKeyListRow) {
    startRevoke(async () => {
      const confirmed = await confirm({
        title: t('revokeConfirmTitle'),
        description: t('revokeConfirmBody', { label: key.label }),
        confirmLabel: t('revoke'),
        cancelLabel: t('cancel'),
        variant: 'destructive',
      });
      if (!confirmed) return;
      const res = await revokeApiKey(key.id);
      if (res.ok) {
        setKeys((prev) =>
          prev.map((k) =>
            k.id === key.id
              ? { ...k, revokedAt: new Date().toISOString() }
              : k,
          ),
        );
        toast({ title: t('revoked') });
      } else {
        toast({ title: errorMessage(res.error), variant: 'destructive' });
      }
    });
  }

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
      <ApiKeysCreateCard
        t={t}
        label={label}
        setLabel={setLabel}
        create={create}
        minting={minting}
      />

      <ApiKeysTable t={t} keys={keys} revoke={revoke} revoking={revoking} />

      <ApiKeysRawDialog
        t={t}
        rawKey={rawKey}
        setRawKey={setRawKey}
        copyRaw={copyRaw}
      />
      {dialog}
    </div>
  );
}
