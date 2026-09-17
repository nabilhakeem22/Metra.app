'use client';

import { Pencil, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import type { ClientContact } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { deleteContact, setPrimaryContact } from '@/lib/client-contacts/actions';

const COLUMNS = ['name', 'role', 'phone', 'email'] as const;

function ContactRowActions({
  contact,
  onEdit,
  run,
  pending,
}: {
  contact: ClientContact;
  onEdit: (contact: ClientContact) => void;
  run: (action: () => Promise<{ ok: boolean; error?: ActionCode }>) => void;
  pending: boolean;
}) {
  const t = useTranslations('clients.profile.contacts');
  return (
    <td className="px-4 py-2">
      <div className="flex items-center justify-end gap-1">
        {!contact.isPrimary && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('setAsPrimary')}
            disabled={pending}
            onClick={() => run(() => setPrimaryContact(contact.id))}
          >
            <Star className="size-4" aria-hidden />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('editTitle')}
          onClick={() => onEdit(contact)}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('delete')}
          disabled={pending}
          onClick={() => run(() => deleteContact(contact.id))}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
    </td>
  );
}

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
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  /** Promote and delete both answer the same way: refresh, or say why not. */
  function run(action: () => Promise<{ ok: boolean; error?: ActionCode }>): void {
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else {
        toast({
          title: resolveActionError(result.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-0">
        {contacts.length === 0 ? (
          <div className="py-4">
            <EmptyState title={t('empty')} />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                {COLUMNS.map((column) => (
                  <th key={column} className="px-4 py-2 text-start font-medium">
                    {t(column)}
                  </th>
                ))}
                {canManage && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-2">
                      {contact.name}
                      {contact.isPrimary && (
                        <span className="bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                          {t('primary')}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{contact.role}</td>
                  <td className="px-4 py-2" dir="ltr">{contact.phone}</td>
                  <td className="px-4 py-2" dir="ltr">{contact.email}</td>
                  {canManage && (
                    <ContactRowActions
                      contact={contact}
                      onEdit={onEdit}
                      run={run}
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
