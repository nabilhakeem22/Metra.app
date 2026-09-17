'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { createContact, updateContact } from '@/lib/client-contacts/actions';
import {
  EMPTY_CONTACT_DRAFT,
  contactPayload,
  validateDraft,
  type ContactDraft,
} from './contact-draft';

/** The four boxes that differ only in their key and their direction. */
const TEXT_FIELDS = [
  { key: 'name', ltr: false },
  { key: 'role', ltr: false },
  { key: 'phone', ltr: true },
  { key: 'email', ltr: true },
  { key: 'whatsapp', ltr: true },
] as const;

export function ContactForm({
  clientId,
  draft,
  onDraftChange,
}: {
  clientId: string;
  draft: ContactDraft;
  onDraftChange: (draft: ContactDraft) => void;
}) {
  const t = useTranslations('clients.profile.contacts');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!validateDraft(draft)) return;
    startTransition(async () => {
      const payload = contactPayload(draft);
      const result = draft.id
        ? await updateContact({ id: draft.id, ...payload })
        : await createContact({ clientId, ...payload, isPrimary: draft.isPrimary });
      if (result.ok) {
        onDraftChange(EMPTY_CONTACT_DRAFT);
        router.refresh();
      } else {
        toast({
          title: resolveActionError(result.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <h3 className="text-sm font-semibold">{draft.id ? t('editTitle') : t('newTitle')}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TEXT_FIELDS.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`ct-${field.key}`}>{t(field.key)}</Label>
              <Input
                id={`ct-${field.key}`}
                dir={field.ltr ? 'ltr' : undefined}
                value={draft[field.key]}
                onChange={(event) =>
                  onDraftChange({ ...draft, [field.key]: event.target.value })
                }
              />
            </div>
          ))}
          {/* Only on CREATE: an existing contact is promoted with its own action,
              which is also the only one that demotes the current primary. */}
          {!draft.id && (
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={draft.isPrimary}
                onChange={(event) =>
                  onDraftChange({ ...draft, isPrimary: event.target.checked })
                }
              />
              {t('primaryOnCreate')}
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {draft.id && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onDraftChange(EMPTY_CONTACT_DRAFT)}
              disabled={pending}
            >
              {t('cancel')}
            </Button>
          )}
          <Button type="button" onClick={submit} disabled={pending || !validateDraft(draft)}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {draft.id ? t('save') : t('add')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
