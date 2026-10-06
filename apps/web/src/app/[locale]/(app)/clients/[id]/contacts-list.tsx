'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import type { ClientContact } from '@metra/db';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/hooks/use-toast';
import { useUndoableRemoval } from '@/hooks/use-undoable-removal';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { deleteContact, setPrimaryContact } from '@/lib/client-contacts/actions';
import { ContactRowActions } from './contact-row-actions';

const COLUMNS = ['name', 'role', 'phone', 'email'] as const;

export function ContactsList({
  contacts,
  canManage,
  onEdit,
}: {
  contacts: ClientContact[];
  canManage: boolean;
  onEdit: (contact: ClientContact) => void;
}) {
  const t = useTranslations('clients.profile.contacts');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirm();
  const refuse = (result: { error?: ActionCode }) =>
    toast({ title: resolveActionError(result.error, te), variant: 'destructive' });
  // Confirmed, then held for the Undo window before the delete really runs.
  const removal = useUndoableRemoval({
    commit: deleteContact,
    messages: { removed: t('deleted'), undo: tc('undo') },
    onCommitted: () => router.refresh(),
    onFailed: refuse,
  });

  function setPrimary(contact: ClientContact): void {
    startTransition(async () => {
      const result = await setPrimaryContact(contact.id);
      if (result.ok) router.refresh();
      else refuse(result);
    });
  }

  async function requestDelete(contact: ClientContact): Promise<void> {
    const confirmed = await confirm({
      title: t('confirmDelete.title'),
      description: t('confirmDelete.body'),
      confirmLabel: t('confirmDelete.confirm'),
      cancelLabel: tc('cancel'),
      variant: 'destructive',
    });
    if (confirmed) removal.remove(contact.id);
  }

  const shown = contacts.filter((contact) => !removal.hiddenIds.has(contact.id));

  return (
    <Card>
      {dialog}
      <CardContent className="p-0">
        {shown.length === 0 ? (
          <div className="py-4">
            <EmptyState title={t('empty')} />
          </div>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="border-b text-caption text-muted-foreground">
                {COLUMNS.map((column) => (
                  <th key={column} className="px-4 py-2 text-start font-medium">
                    {t(column)}
                  </th>
                ))}
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {shown.map((contact) => (
                <tr key={contact.id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-2">
                      <bdi>{contact.name}</bdi>
                      {contact.isPrimary && (
                        <span className="bg-primary/10 px-1.5 py-0.5 text-caption text-primary">
                          {t('primary')}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground" dir="auto">
                    {contact.role}
                  </td>
                  <td className="px-4 py-2" dir="ltr">{contact.phone}</td>
                  <td className="px-4 py-2" dir="ltr">{contact.email}</td>
                  {canManage && (
                    <ContactRowActions
                      contact={contact}
                      onEdit={onEdit}
                      onSetPrimary={setPrimary}
                      onDelete={(target) => void requestDelete(target)}
                      pending={pending}
                    />
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
