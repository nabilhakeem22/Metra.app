'use client';

import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useTransition, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import {
  createClientDocumentUpload,
  deleteClientDocument,
  getClientDocumentUrl,
} from '@/lib/client-documents/actions';
import type { ClientDocument } from '@/lib/client-documents/queries';
import { formatDate } from '@/lib/format/date';

export function DocumentsTab({
  clientId,
  documents,
  canManage,
}: {
  clientId: string;
  documents: ClientDocument[];
  canManage: boolean;
}) {
  const t = useTranslations('clients.profile.documents');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    startTransition(async () => {
      try {
        const signed = await createClientDocumentUpload({
          clientId,
          contentType: file.type,
          originalName: file.name,
        });
        if ('ok' in signed) throw new Error('forbidden');
        const put = await fetch(signed.signedUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type, 'x-upsert': 'true' },
          body: file,
        });
        if (!put.ok) throw new Error('put_failed');
        toast({ title: t('uploaded') });
        router.refresh();
      } catch {
        toast({ title: t('upload'), variant: 'destructive' });
      } finally {
        if (inputRef.current) inputRef.current.value = '';
      }
    });
  }

  function onDownload(id: string) {
    startTransition(async () => {
      const res = await getClientDocumentUrl(id);
      if (res.ok && res.url) window.open(res.url, '_blank', 'noopener');
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      const res = await deleteClientDocument(id);
      if (res.ok) {
        toast({ title: t('deleted') });
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={onUpload}
            disabled={pending}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            {t('upload')}
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {documents.length === 0 ? (
            <div className="py-4">
              <EmptyState title={t('empty')} />
            </div>
          ) : (
            <ul className="divide-y">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate text-sm">
                    {d.originalName ?? d.id}
                  </span>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {formatDate(d.createdAt, locale)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('download')}
                    onClick={() => onDownload(d.id)}
                    disabled={pending}
                  >
                    <Download className="size-4" aria-hidden />
                  </Button>
                  {canManage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('delete')}
                      onClick={() => onDelete(d.id)}
                      disabled={pending}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
