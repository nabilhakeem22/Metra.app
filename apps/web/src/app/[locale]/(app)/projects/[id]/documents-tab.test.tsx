import { beforeEach, describe, vi } from 'vitest';
import type { EntityDocument } from '@/lib/documents/queries';
import { renderWithIntl } from '@/test/render-with-intl';
import type { CapturedToast } from '@/test/doubles';
import { assertDocumentsTabFailureToasts } from '@/test/documents-tab-contract';
import { DocumentsTab } from './documents-tab';

const actions = vi.hoisted(() => ({
  createProjectDocumentUpload: vi.fn(),
  deleteProjectDocument: vi.fn(),
  getProjectDocumentUrl: vi.fn(),
}));
vi.mock('@/lib/documents/actions', () => actions);

const toasts = vi.hoisted(() => [] as CapturedToast[]);
vi.mock('@/hooks/use-toast', () => ({
  toast: (raised: CapturedToast) => {
    toasts.push(raised);
  },
}));

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
  usePathname: () => '/ar-EG/projects/p-1',
}));

const DOCUMENT_NAME = 'contract-signed.pdf';

const documents: EntityDocument[] = [
  {
    id: 'f-1',
    originalName: DOCUMENT_NAME,
    contentType: 'application/pdf',
    createdAt: '2026-05-01T09:00:00.000Z',
    categoryId: null,
    categoryNameEn: null,
    categoryNameAr: null,
  },
];

beforeEach(() => {
  toasts.length = 0;
  router.refresh.mockClear();
  actions.deleteProjectDocument.mockReset();
  actions.getProjectDocumentUrl.mockReset();
});

describe("projects/[id] DocumentsTab — wave 3's F1 toasts", () => {
  assertDocumentsTabFailureToasts({
    entity: 'project',
    namespace: 'projects.profile.documents',
    documentName: DOCUMENT_NAME,
    renderTab: () =>
      renderWithIntl(
        <DocumentsTab
          projectId="p-1"
          documents={documents}
          categories={[]}
          canManage
        />,
      ),
    actions: {
      deleteDocument: actions.deleteProjectDocument,
      getDocumentUrl: actions.getProjectDocumentUrl,
    },
    toasts,
    router,
  });
});
