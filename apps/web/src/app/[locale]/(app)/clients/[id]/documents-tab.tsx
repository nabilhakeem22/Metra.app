'use client';

import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  createClientDocumentUpload,
  deleteClientDocument,
  getClientDocumentUrl,
} from '@/lib/documents/actions';
import type { EntityDocument } from '@/lib/documents/queries';
import { groupByCategory } from '@/components/documents/document-groups';
import { useDocumentDeletion } from '@/components/documents/use-document-deletion';
import { formatDate } from '@/lib/format/date';
import { pickLocale } from '@/lib/i18n/pick-locale';

export function DocumentsTab({
  clientId,
  documents,
  categories,
  canManage,
}: {
  clientId: string;
  documents: EntityDocument[];
  /** The firm's ACTIVE filing categories — what a new document may go under. */
  categories: Array<{ id: string; nameEn: string | null; nameAr: string | null }>;
  canManage: boolean;
}) {
  const t = useTranslations('clients.profile.documents');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Chosen BEFORE picking the file, so the document is filed at the moment it
  // arrives rather than needing a second step nobody comes back to do.
  const [categoryId, setCategoryId] = useState('');

  function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    startTransition(async () => {
      try {
        const signed = await createClientDocumentUpload({
          clientId,
          contentType: file.type,
          originalName: file.name,
          categoryId: categoryId || null,
        });
        if ('ok' in signed) {
          toast({
            title: resolveActionError(signed.error as ActionCode, te),
            variant: 'destructive',
          });
          return;
        }
        const put = await fetch(signed.signedUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type, 'x-upsert': 'true' },
          body: file,
        });
        if (!put.ok) throw new Error('put_failed');
        toast({ title: t('uploaded') });
        router.refresh();
      } catch {
        toast({ title: te('generic'), variant: 'destructive' });
      } finally {
        if (inputRef.current) inputRef.current.value = '';
      }
    });
  }

  function onDownload(id: string) {
    startTransition(async () => {
      const res = await getClientDocumentUrl(id);
      if (res.ok && res.url) {
        window.open(res.url, '_blank', 'noopener');
        return;
      }
      toast({ title: resolveActionError(res.error, te), variant: 'destructive' });
    });
  }

  const deletion = useDocumentDeletion({ deleteDocument: deleteClientDocument, t });
  const shown = documents.filter((document) => !deletion.hiddenIds.has(document.id));

  return (
    <div className="space-y-4">
      {deletion.dialog}
      {canManage && (
        <div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={onUpload}
            disabled={pending}
          />
          {categories.length > 0 && (
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label={t('category')}
              disabled={pending}
              className="h-9 rounded-item border bg-background px-2 text-body"
            >
              <option value="">{t('uncategorised')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {pickLocale({ nameAr: c.nameAr, nameEn: c.nameEn }, 'name', locale).value}
                </option>
              ))}
            </select>
          )}
          <Button
            type="button"
            variant="secondary"
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
          {shown.length === 0 ? (
            <div className="py-4">
              <EmptyState title={t('empty')} />
            </div>
          ) : (
            <div className="divide-y">
              {groupByCategory(shown).map((group) => (
                <section key={group.categoryId ?? 'uncategorised'}>
                  <p className="bg-muted/40 px-4 py-1.5 text-caption font-semibold text-muted-foreground">
                    {group.categoryId
                      ? pickLocale(
                          { nameAr: group.nameAr, nameEn: group.nameEn },
                          'name',
                          locale,
                        ).value
                      : t('uncategorised')}
                  </p>
                  <ul className="divide-y">
                    {group.documents.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate text-body">
                    {d.originalName ?? d.id}
                  </span>
                  <span className="text-caption text-muted-foreground" dir="ltr">
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
                    <OverflowMenu
                      label={tc('moreActions')}
                      disabled={pending}
                      actions={[
                        {
                          key: 'delete',
                          label: t('delete'),
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => void deletion.requestDelete(d.id),
                        },
                      ]}
                    />
                  )}
                    </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
