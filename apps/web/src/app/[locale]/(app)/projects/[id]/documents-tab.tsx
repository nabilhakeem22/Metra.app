'use client';

import { useTranslations } from 'next-intl';
import { EntityDocumentsPanel } from '@/components/documents/entity-documents-panel';
import {
  createProjectDocumentUpload,
  deleteProjectDocument,
  getProjectDocumentUrl,
} from '@/lib/documents/actions';
import type { EntityDocument } from '@/lib/documents/queries';

export function DocumentsTab({
  projectId,
  documents,
  categories,
  canManage,
}: {
  projectId: string;
  documents: EntityDocument[];
  categories: Array<{ id: string; nameEn: string | null; nameAr: string | null }>;
  canManage: boolean;
}) {
  const t = useTranslations('projects.profile.documents');
  return (
    <EntityDocumentsPanel
      documents={documents}
      categories={categories}
      canManage={canManage}
      t={t}
      createUpload={(upload) => createProjectDocumentUpload({ projectId, ...upload })}
      deleteDocument={deleteProjectDocument}
      getDocumentUrl={getProjectDocumentUrl}
    />
  );
}
