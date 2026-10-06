'use client';

import { Pencil, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ClientContact } from '@metra/db';
import { Button } from '@/components/ui/button';
import { OverflowMenu } from '@/components/ui/overflow-menu';

/** Edit stays one click away; promoting and deleting live in the row menu. */
export function ContactRowActions({
  contact,
  onEdit,
  onSetPrimary,
  onDelete,
  pending,
}: {
  contact: ClientContact;
  onEdit: (contact: ClientContact) => void;
  onSetPrimary: (contact: ClientContact) => void;
  onDelete: (contact: ClientContact) => void;
  pending: boolean;
}) {
  const t = useTranslations('clients.profile.contacts');
  const tc = useTranslations('common');
  return (
    <td className="px-4 py-2">
      <div className="flex items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('editTitle')}
          onClick={() => onEdit(contact)}
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
        <OverflowMenu
          label={tc('moreActions')}
          disabled={pending}
          actions={[
            ...(contact.isPrimary
              ? []
              : [
                  {
                    key: 'primary',
                    label: t('setAsPrimary'),
                    icon: Star,
                    onSelect: () => onSetPrimary(contact),
                  },
                ]),
            {
              key: 'delete',
              label: t('delete'),
              icon: Trash2,
              destructive: true,
              onSelect: () => onDelete(contact),
            },
          ]}
        />
      </div>
    </td>
  );
}
