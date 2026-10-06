'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ClientContact } from '@metra/db';
import { Button } from '@/components/ui/button';
import {
  EMPTY_CONTACT_DRAFT,
  draftFromContact,
  type ContactDraft,
} from './contact-draft';
import { ContactForm } from './contact-form';
import { ContactsList } from './contacts-list';

/**
 * The client's contacts: COMPOSITION. The list, and one form sheet shared by
 * "Add contact" and each row's edit, both of which fill the same draft.
 */
export function ContactsTab({
  clientId,
  contacts,
  canManage,
}: {
  clientId: string;
  contacts: ClientContact[];
  canManage: boolean;
}) {
  const t = useTranslations('clients.profile.contacts');
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_CONTACT_DRAFT);
  const [formOpen, setFormOpen] = useState(false);

  function openWith(next: ContactDraft): void {
    setDraft(next);
    setFormOpen(true);
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={() => openWith(EMPTY_CONTACT_DRAFT)}>
            <Plus className="size-4" aria-hidden />
            {t('add')}
          </Button>
        </div>
      )}

      <ContactsList
        contacts={contacts}
        canManage={canManage}
        onEdit={(contact) => openWith(draftFromContact(contact))}
      />

      {canManage && (
        <ContactForm
          clientId={clientId}
          open={formOpen}
          onOpenChange={setFormOpen}
          draft={draft}
          onDraftChange={setDraft}
        />
      )}
    </div>
  );
}
