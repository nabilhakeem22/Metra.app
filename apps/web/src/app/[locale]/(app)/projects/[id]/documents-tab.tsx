'use client';

import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  createProjectDocumentUpload,
  deleteProjectDocument,
  getProjectDocumentUrl,
} from '@/lib/project-documents/actions';
import type { ProjectDocument } from '@/lib/project-documents/queries';
import { groupByCategory } from '@/components/documents/document-groups';
import { formatDate } from '@/lib/format/date';
import { pickLocale } from '@/lib/i18n/pick-locale';

export function DocumentsTab({
  projectId,
  documents,
  categories,
  canManage,
}: {
  projectId: string;
  documents: ProjectDocument[];
  /** The firm's ACTIVE filing categories — what a new document may go under. */
  categories: Array<{ id: string; nameEn: string | null; nameAr: string | null }>;
  canManage: boolean;
}) {
  const t = useTranslations('projects.profile.documents');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Chosen BEFORE picking the file, so the document is filed as it arrives.
  const [categoryId, setCategoryId] = useState('');

  function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    startTransition(async () => {
      try {
        const signed = await createProjectDocumentUpload({
          projectId,
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
      const res = await getProjectDocumentUrl(id);
      if (res.ok && res.url) window.open(res.url, '_blank', 'noopener');
    });
  }

  function onDelete(id: string) {
    startTransition(async () => {
      const res = await deleteProjectDocument(id);
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
          {categories.length > 0 && (
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              aria-label={t('category')}
              disabled={pending}
              className="h-9 rounded-md border bg-background px-2 text-sm"
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
            <div className="divide-y">
              {groupByCategory(documents).map((group) => (
                <section key={group.categoryId ?? 'uncategorised'}>
                  <p className="bg-muted/40 px-4 py-1.5 text-xs font-semibold text-muted-foreground">
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
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
