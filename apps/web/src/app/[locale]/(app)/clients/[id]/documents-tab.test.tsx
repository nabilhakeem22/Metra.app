import { beforeEach, describe, vi } from 'vitest';
import type { EntityDocument } from '@/lib/documents/queries';
import { renderWithIntl } from '@/test/render-with-intl';
import type { CapturedToast } from '@/test/doubles';
import { assertDocumentsTabFailureToasts } from '@/test/documents-tab-contract';
import { DocumentsTab } from './documents-tab';

const actions = vi.hoisted(() => ({
  createClientDocumentUpload: vi.fn(),
  deleteClientDocument: vi.fn(),
  getClientDocumentUrl: vi.fn(),
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
  usePathname: () => '/ar-EG/clients/c-1',
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
  actions.deleteClientDocument.mockReset();
  actions.getClientDocumentUrl.mockReset();
});

describe("clients/[id] DocumentsTab — wave 3's F1 toasts", () => {
  assertDocumentsTabFailureToasts({
    entity: 'client',
    namespace: 'clients.profile.documents',
    documentName: DOCUMENT_NAME,
    renderTab: () =>
      renderWithIntl(
        <DocumentsTab
          clientId="c-1"
          documents={documents}
          categories={[]}
          canManage
        />,
      ),
    actions: {
      deleteDocument: actions.deleteClientDocument,
      getDocumentUrl: actions.getClientDocumentUrl,
    },
    toasts,
    router,
  });
});
