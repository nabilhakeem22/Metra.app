'use client';

import { Download, FileText, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import {
  createClientDocumentUpload,
  deleteClientDocument,
  getClientDocumentUrl,
} from '@/lib/documents/actions';
import type { EntityDocument } from '@/lib/documents/queries';
import { groupByCategory } from '@/components/documents/document-groups';
import { DocumentUploadControl } from '@/components/documents/document-upload-control';
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
  const [pending, startTransition] = useTransition();

  // A row act with no field: the toast names the cause (D11).
  function onDownload(id: string) {
    startTransition(async () => {
      try {
        const res = await getClientDocumentUrl(id);
        if (res.ok && res.url) {
          window.open(res.url, '_blank', 'noopener');
          return;
        }
        toast({ title: describeFailure(res, te), variant: 'destructive' });
      } catch (rejection) {
        toast({ title: describeRejection(rejection, te), variant: 'destructive' });
      }
    });
  }

  const deletion = useDocumentDeletion({ deleteDocument: deleteClientDocument, t });
  const shown = documents.filter((document) => !deletion.hiddenIds.has(document.id));

  return (
    <div className="space-y-4">
      {deletion.dialog}
      {canManage && (
        <DocumentUploadControl
          categories={categories}
          createUpload={(upload) => createClientDocumentUpload({ clientId, ...upload })}
          t={t}
        />
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
