'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { SectionLabel } from '@/components/ui/section-label';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { updateClientPageDetails } from '@/lib/org/client-page-actions';
import type { ClientPageField } from '@/lib/org/client-page-details';
import { CLIENT_PAGE_FIELD_SPECS, changedDraftFields, type ClientPageDraft } from './client-page-fields';

type Refusal = { code: ActionCode; field: ClientPageField | null };

/**
 * Edit what the client page shows about the studio, in the app's form sheet.
 * A refusal is said under the field it names (no toast); one that names no
 * field is said above the footer. Owner/admin only: the card opens it only
 * for them, and the server action re-checks.
 */
export function ClientPageSheet({
  open,
  onOpenChange,
  initial,
  revision,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ClientPageDraft;
  /** The stored values' revision the sheet saves against (a stale save is refused). */
  revision: string;
}) {
  const t = useTranslations('settings.clientPage');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(initial);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setRefusal(null);
  }, [open, initial]);

  const messageOf = (found: Refusal) =>
    found.code === 'invalid' && found.field ? t(`fieldInvalid.${found.field}`) : resolveActionError(found.code, te);

  function submit() {
    setRefusal(null);
    startTransition(async () => {
      try {
        const result = await updateClientPageDetails({ revision, changes: changedDraftFields(initial, draft) });
        if (result.ok) {
          toast({ title: t('saved') });
          onOpenChange(false);
          router.refresh();
          return;
        }
        setRefusal({ code: result.error ?? 'generic', field: result.field ?? null });
      } catch {
        setRefusal({ code: 'generic', field: null });
      }
    });
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('subtitle')}
      onSubmit={submit}
      submitLabel={t('save')}
      cancelLabel={tc('cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={refusal && !refusal.field ? messageOf(refusal) : null}
    >
      <p className="text-caption text-muted-foreground">{t('alertNote')}</p>
      {(['contact', 'payment'] as const).map((group) => (
        <div key={group} className="space-y-4">
          <SectionLabel as="h3">{t(group === 'contact' ? 'contactHeading' : 'paymentHeading')}</SectionLabel>
          {CLIENT_PAGE_FIELD_SPECS.filter((spec) => spec.group === group).map((spec) => (
            <FormField
              key={spec.field}
              id={`client-page-${spec.field}`}
              label={t(`fields.${spec.field}`)}
              error={refusal?.field === spec.field ? messageOf(refusal) : null}
            >
              <Input
                dir={spec.ltr ? 'ltr' : 'auto'}
                inputMode={spec.inputMode}
                autoComplete={spec.autoComplete ?? 'off'}
                value={draft[spec.field]}
                onChange={(event) => setDraft({ ...draft, [spec.field]: event.target.value })}
              />
            </FormField>
          ))}
        </div>
      ))}
    </FormSheet>
  );
}
