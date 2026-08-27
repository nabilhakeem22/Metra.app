'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Copy } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

// The one-time raw-key reveal dialog. All state and the copy handler live in
// the parent (ApiKeysClient); this child is presentational, driven by the
// passed value + callbacks.
export function ApiKeysRawDialog({
  t,
  rawKey,
  setRawKey,
  copyRaw,
}: {
  t: ReturnType<typeof useTranslations<'apiKeys'>>;
  rawKey: string | null;
  setRawKey: (value: string | null) => void;
  copyRaw: () => void;
}) {
  return (
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
  );
}
