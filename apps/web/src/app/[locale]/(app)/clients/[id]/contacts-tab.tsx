'use client';

import { Loader2, Pencil, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { ClientContact } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  createContact,
  deleteContact,
  setPrimaryContact,
  updateContact,
} from '@/lib/client-contacts/actions';

interface Draft {
  id: string | null;
  name: string;
  role: string;
  phone: string;
  email: string;
  whatsapp: string;
  isPrimary: boolean;
}

const EMPTY: Draft = {
  id: null,
  name: '',
  role: '',
  phone: '',
  email: '',
  whatsapp: '',
  isPrimary: false,
};

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
  const te = useTranslations('errors');
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, startTransition] = useTransition();

  const set = (k: keyof Draft) => (v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  function done(res: { ok: boolean; error?: ActionCode }, resetForm = false) {
    if (res.ok) {
      if (resetForm) setDraft(EMPTY);
      router.refresh();
    } else {
      toast({
        title: resolveActionError(res.error as ActionCode, te),
        variant: 'destructive',
      });
    }
  }

  function submit() {
    if (!draft.name.trim()) return;
    startTransition(async () => {
      const payload = {
        name: draft.name,
        role: draft.role || null,
        phone: draft.phone || null,
        email: draft.email || null,
        whatsapp: draft.whatsapp || null,
      };
      const res = draft.id
        ? await updateContact({ id: draft.id, ...payload })
        : await createContact({ clientId, ...payload, isPrimary: draft.isPrimary });
      done(res, true);
    });
  }

  function edit(c: ClientContact) {
    setDraft({
      id: c.id,
      name: c.name,
      role: c.role ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      whatsapp: c.whatsapp ?? '',
      isPrimary: c.isPrimary,
    });
  }

  return (
    <div className="space-y-4">
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
                  <th className="px-4 py-2 text-start font-medium">{t('name')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('role')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('phone')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('email')}</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-2">
                        {c.name}
                        {c.isPrimary && (
                          <span className="bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                            {t('primary')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{c.role}</td>
                    <td className="px-4 py-2" dir="ltr">{c.phone}</td>
                    <td className="px-4 py-2" dir="ltr">{c.email}</td>
                    {canManage && (
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {!c.isPrimary && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t('setAsPrimary')}
                              disabled={pending}
                              onClick={() =>
                                startTransition(async () =>
                                  done(await setPrimaryContact(c.id)),
                                )
                              }
                            >
                              <Star className="size-4" aria-hidden />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('editTitle')}
                            onClick={() => edit(c)}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t('delete')}
                            disabled={pending}
                            onClick={() =>
                              startTransition(async () =>
                                done(await deleteContact(c.id)),
                              )
                            }
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <h3 className="text-sm font-semibold">
              {draft.id ? t('editTitle') : t('newTitle')}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ct-name">{t('name')}</Label>
                <Input id="ct-name" value={draft.name} onChange={(e) => set('name')(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-role">{t('role')}</Label>
                <Input id="ct-role" value={draft.role} onChange={(e) => set('role')(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-phone">{t('phone')}</Label>
                <Input id="ct-phone" dir="ltr" value={draft.phone} onChange={(e) => set('phone')(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-email">{t('email')}</Label>
                <Input id="ct-email" dir="ltr" value={draft.email} onChange={(e) => set('email')(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-wa">{t('whatsapp')}</Label>
                <Input id="ct-wa" dir="ltr" value={draft.whatsapp} onChange={(e) => set('whatsapp')(e.target.value)} />
              </div>
              {!draft.id && (
                <label className="flex items-center gap-2 self-end text-sm">
                  <input
                    type="checkbox"
                    checked={draft.isPrimary}
                    onChange={(e) => setDraft((d) => ({ ...d, isPrimary: e.target.checked }))}
                  />
                  {t('primaryOnCreate')}
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2">
              {draft.id && (
                <Button type="button" variant="outline" onClick={() => setDraft(EMPTY)} disabled={pending}>
                  {t('cancel')}
                </Button>
              )}
              <Button type="button" onClick={submit} disabled={pending || !draft.name.trim()}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {draft.id ? t('save') : t('add')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
