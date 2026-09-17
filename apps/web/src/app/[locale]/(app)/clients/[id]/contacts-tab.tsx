'use client';

import { useState } from 'react';
import type { ClientContact } from '@metra/db';
import {
  EMPTY_CONTACT_DRAFT,
  draftFromContact,
  type ContactDraft,
} from './contact-draft';
import { ContactForm } from './contact-form';
import { ContactsList } from './contacts-list';

/**
 * The client's contacts — COMPOSITION.
 *
 * ONE draft is shared between the list and the form: clicking the pencil on a row
 * fills the form below rather than opening a dialog, so the studio can see the
 * other contacts while editing one of them.
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
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_CONTACT_DRAFT);

  return (
    <div className="space-y-4">
      <ContactsList
        contacts={contacts}
        canManage={canManage}
        onEdit={(contact) => setDraft(draftFromContact(contact))}
      />

      {canManage && (
        <ContactForm clientId={clientId} draft={draft} onDraftChange={setDraft} />
      )}
    </div>
  );
}
