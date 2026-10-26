'use client';

import { useTranslations } from 'next-intl';
import { EntityDocumentsPanel } from '@/components/documents/entity-documents-panel';
import {
  createClientDocumentUpload,
  deleteClientDocument,
  getClientDocumentUrl,
} from '@/lib/documents/actions';
import type { EntityDocument } from '@/lib/documents/queries';

export function DocumentsTab({
  clientId,
  documents,
  categories,
  canManage,
}: {
  clientId: string;
  documents: EntityDocument[];
  categories: Array<{ id: string; nameEn: string | null; nameAr: string | null }>;
  canManage: boolean;
}) {
  const t = useTranslations('clients.profile.documents');
  return (
    <EntityDocumentsPanel
      documents={documents}
      categories={categories}
      canManage={canManage}
      t={t}
      createUpload={(upload) => createClientDocumentUpload({ clientId, ...upload })}
      deleteDocument={deleteClientDocument}
      getDocumentUrl={getClientDocumentUrl}
    />
  );
}
