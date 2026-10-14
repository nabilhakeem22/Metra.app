import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult } from '@/lib/actions/result';
import { PROPOSAL_CREATE_FIELDS } from '@/lib/proposals/create-fields';
import { expectFieldErrorsRenderUnderFields } from '@/test/field-coverage';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { ProposalCreateForm } from './create-form';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => router,
}));
const actions = vi.hoisted(() => ({ createProposal: vi.fn() }));
vi.mock('@/lib/proposals/actions', () => actions);
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ toast }));

const CLIENTS = [{ id: '11111111-1111-4111-8111-111111111111', nameEn: 'Acme', nameAr: null }];
const PROJECTS = [
  { id: '22222222-2222-4222-8222-222222222222', nameEn: 'Tower', nameAr: null, clientId: CLIENTS[0].id },
];
const CONTROL: Record<(typeof PROPOSAL_CREATE_FIELDS)[number], string> = {
  clientId: 'np-client',
  projectId: 'np-project',
  issueDate: 'np-issue',
  expiryDate: 'np-expiry',
};

beforeEach(() => {
  actions.createProposal.mockReset();
  toast.mockReset();
});

describe.each<TestLocale>(['en', 'ar-EG'])('ProposalCreateForm (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);
  const renderForm = () => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(<ProposalCreateForm clients={CLIENTS} projects={PROJECTS} />, { locale });
  };
  const submit = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: at('proposals.create.submit') }));
    });
  };

  test('every field the server refuses is said under its own control', async () => {
    renderForm();
    await expectFieldErrorsRenderUnderFields({
      fields: PROPOSAL_CREATE_FIELDS,
      controlIdOf: (field) => CONTROL[field],
      answerWith: (result: ActionResult) => actions.createProposal.mockResolvedValue(result),
      submit,
      locale,
    });
    expect(toast).not.toHaveBeenCalled();
  });

  test('a created proposal opens', async () => {
    actions.createProposal.mockResolvedValue({ ok: true, data: 'p-9' });
    renderForm();
    await submit();
    expect(router.push).toHaveBeenCalledWith('/proposals/p-9');
  });
});
