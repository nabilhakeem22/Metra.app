import { screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { EntityDocument } from '@/lib/documents/queries';
import { openMenu } from '@/test/open-menu';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { EntityDocumentsPanel } from './entity-documents-panel';

// Security batch 3, A6: the row menu (Delete is its one action) follows what the
// server will allow for THIS member, row by row. The server decides again on
// the delete itself (tests/actions/documents-delete-scope.dbtest.ts); this is
// only about not offering an act that would be refused.

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const text = (key: string) => key;

function documentNamed(originalName: string, deletable: boolean): EntityDocument {
  return {
    id: `id-of-${originalName}`,
    originalName,
    contentType: 'application/pdf',
    createdAt: '2026-05-01T09:00:00.000Z',
    categoryId: null,
    categoryNameEn: null,
    categoryNameAr: null,
    deletable,
  };
}

const MINE = 'my-site-photo.pdf';
const COLLEAGUES = 'signed-agreement.pdf';

function renderPanel(locale: TestLocale, canManage: boolean) {
  renderWithIntl(
    <EntityDocumentsPanel
      documents={[documentNamed(MINE, true), documentNamed(COLLEAGUES, false)]}
      categories={[]}
      canManage={canManage}
      t={text}
      createUpload={vi.fn()}
      deleteDocument={vi.fn()}
      getDocumentUrl={vi.fn()}
    />,
    { locale },
  );
}

function rowOf(documentName: string): HTMLElement {
  const row = screen.getByText(documentName).closest('li');
  if (!row) throw new Error(`no row for ${documentName}`);
  return row;
}

describe.each<TestLocale>(['en', 'ar-EG'])('EntityDocumentsPanel row menu (%s)', (locale) => {
  const moreActions = messageAt(locale, 'common.moreActions');

  test('a row the member may not delete has no menu; one they may delete has it, with Delete inside (AC10)', () => {
    renderPanel(locale, true);
    expect(within(rowOf(COLLEAGUES)).queryByRole('button', { name: moreActions })).toBeNull();
    expect(within(rowOf(MINE)).getAllByRole('button', { name: moreActions })).toHaveLength(1);

    openMenu(moreActions);
    expect(screen.getAllByRole('menuitem', { name: 'delete' })).toHaveLength(1);
  });

  test('both rows keep their download button', () => {
    renderPanel(locale, true);
    for (const name of [MINE, COLLEAGUES]) {
      expect(within(rowOf(name)).getAllByRole('button', { name: 'download' })).toHaveLength(1);
    }
  });

  test('a member who may not manage documents gets no menu, even on a deletable row', () => {
    renderPanel(locale, false);
    expect(screen.queryByRole('button', { name: moreActions })).toBeNull();
  });
});
