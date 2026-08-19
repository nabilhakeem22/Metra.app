'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Copy, Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { mintApiKey, revokeApiKey } from '@/lib/api-keys/actions';
import { MAX_API_KEY_LABEL_LEN } from '@/lib/api-keys/constants';
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
      <Card>
        <CardHeader>
          <CardTitle>{t('createTitle')}</CardTitle>
          <CardDescription>{t('createSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key-label">{t('labelLabel')}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="api-key-label"
                value={label}
                maxLength={MAX_API_KEY_LABEL_LEN}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('labelPlaceholder')}
                className="max-w-xs"
              />
              <Button onClick={create} disabled={minting || !label.trim()}>
                {minting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="size-4" aria-hidden />
                )}
                {t('create')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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

      <AlertDialog.Root
        open={rawKey !== null}
        onOpenChange={(next) => {
          if (!next) setRawKey(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm" />
          <AlertDialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-lg -translate-y-1/2 rounded-2xl border bg-card p-6 text-start shadow-card outline-none">
            <AlertDialog.Title className="text-lg font-semibold">
              {t('rawKeyTitle')}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
              {t('rawKeyWarning')}
            </AlertDialog.Description>
            <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
              <code className="flex-1 break-all font-mono text-xs" dir="ltr">
                {rawKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={copyRaw}
                aria-label={t('copy')}
              >
                <Copy className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="mt-6 flex justify-end">
              <AlertDialog.Action asChild>
                <Button onClick={() => setRawKey(null)}>{t('done')}</Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {dialog}
    </div>
  );
}
