import { expect, test, vi, type Mock } from 'vitest';
import { fireEvent, screen, waitFor, type RenderResult } from '@testing-library/react';
import { messageAt } from './render-with-intl';
import type { CapturedToast } from './doubles';

// TEST-ONLY. ONE assertion set, driven twice.
//
// clients/[id]/documents-tab.tsx and projects/[id]/documents-tab.tsx differ by 13
// lines, all of them the entity word. Deduping the PRODUCT is report F11 and wave
// 6's job; this wave only proves their toasts — and the duplication must not
// spread into the tests, so both test files delegate here. A fix applied to one
// tab and not the other reds the other tab's test.

export interface DocumentsTabContract {
  entity: 'client' | 'project';
  namespace: 'clients.profile.documents' | 'projects.profile.documents';
  /** The caller wires its own props; this contract never constructs the tab. */
  renderTab: () => RenderResult;
  /** The name of the ONE document `renderTab` puts on screen. */
  documentName: string;
  actions: { deleteDocument: Mock; getDocumentUrl: Mock };
  /** The array the caller's `vi.mock('@/hooks/use-toast')` factory pushes into. */
  toasts: CapturedToast[];
  /** The caller's doubled router, so "did it refresh" is answerable. */
  router: { refresh: Mock };
}

const ar = (path: string) => messageAt('ar-EG', path);

function lastToast(toasts: CapturedToast[]): CapturedToast {
  const toast = toasts.at(-1);
  if (!toast) throw new Error('no toast was raised');
  return toast;
}

function clickDownload(contract: DocumentsTabContract): void {
  fireEvent.click(screen.getByRole('button', { name: ar(`${contract.namespace}.download`) }));
}

function clickDelete(contract: DocumentsTabContract): void {
  fireEvent.click(screen.getByRole('button', { name: ar(`${contract.namespace}.delete`) }));
}

/**
 * Wave 3's F1: a refused download used to open a tab at nothing and say nothing.
 * `invalid` is what `getDocumentUrlCore` actually returns for a file that is not
 * this org's — the coded refusal must reach the screen as the CATALOGUE string.
 */
async function downloadRefusalIsToldAndDoesNotNavigate(
  contract: DocumentsTabContract,
): Promise<void> {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  contract.actions.getDocumentUrl.mockResolvedValue({ ok: false, error: 'invalid' });
  contract.renderTab();

  clickDownload(contract);

  await waitFor(() => {
    expect(contract.toasts).toHaveLength(1);
  });
  expect(lastToast(contract.toasts)).toEqual({
    title: ar('errors.invalid'),
    variant: 'destructive',
  });
  expect(open).not.toHaveBeenCalled();
  open.mockRestore();
}

/** A successful download opens the signed URL and raises no toast. */
async function downloadSuccessOpensTheSignedUrl(
  contract: DocumentsTabContract,
): Promise<void> {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  contract.actions.getDocumentUrl.mockResolvedValue({ ok: true, url: 'https://signed/x' });
  contract.renderTab();

  clickDownload(contract);

  await waitFor(() => {
    expect(open).toHaveBeenCalledWith('https://signed/x', '_blank', 'noopener');
  });
  expect(contract.toasts).toHaveLength(0);
  open.mockRestore();
}

/**
 * `uncertain` above all: the row may or may not be gone, so the studio is told to
 * refresh and check rather than left watching a file that did not react. The row
 * therefore STAYS on screen — the tab must not optimistically remove it.
 */
async function deleteRefusalIsToldAndLeavesTheRow(
  contract: DocumentsTabContract,
): Promise<void> {
  contract.actions.deleteDocument.mockResolvedValue({ ok: false, error: 'uncertain' });
  contract.renderTab();

  clickDelete(contract);

  await waitFor(() => {
    expect(contract.toasts).toHaveLength(1);
  });
  expect(lastToast(contract.toasts)).toEqual({
    title: ar('errors.uncertain'),
    variant: 'destructive',
  });
  expect(screen.getByText(contract.documentName)).toBeTruthy();
  expect(contract.actions.deleteDocument).toHaveBeenCalledTimes(1);
}

/** A successful delete toasts the TAB'S OWN `deleted` key, not a shared one. */
async function deleteSuccessToastsTheNamespacesOwnKey(
  contract: DocumentsTabContract,
): Promise<void> {
  contract.actions.deleteDocument.mockResolvedValue({ ok: true });
  contract.renderTab();

  clickDelete(contract);

  await waitFor(() => {
    expect(contract.toasts).toHaveLength(1);
  });
  expect(lastToast(contract.toasts)).toEqual({ title: ar(`${contract.namespace}.deleted`) });
  expect(contract.router.refresh).toHaveBeenCalled();
}

/** Declares this contract's `test()` blocks inside the caller's `describe`. */
export function assertDocumentsTabFailureToasts(contract: DocumentsTabContract): void {
  test(`a refused download toasts the coded refusal and does not open a tab`, () =>
    downloadRefusalIsToldAndDoesNotNavigate(contract));

  test(`a granted download opens the signed url and says nothing`, () =>
    downloadSuccessOpensTheSignedUrl(contract));

  test(`a refused delete toasts the coded refusal and LEAVES the row on screen`, () =>
    deleteRefusalIsToldAndLeavesTheRow(contract));

  test(`a successful delete toasts ${contract.namespace}.deleted and refreshes`, () =>
    deleteSuccessToastsTheNamespacesOwnKey(contract));
}
