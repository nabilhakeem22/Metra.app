'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import type { MemberRole } from '@/lib/permissions/roles';
import { inviteMember } from '@/lib/team/actions';
import { INVITE_FIELDS, inviteFieldErrors } from '@/lib/team/invite-field-rules';

/**
 * The invite card's state and Send. Send is never disabled to say "not yet":
 * pressing it with an empty or malformed address says so under Email and
 * sends nothing (A4). A member or a pending invite with that address is said
 * there too; a refusal no field owns, above the button.
 */
export function useInviteForm(onLink: (link: string | null) => void) {
  const t = useTranslations('team');
  const te = useTranslations('errors');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('viewer');
  const [sending, startSending] = useTransition();
  const errors = useFieldErrors({ fields: INVITE_FIELDS, translate: te });

  function send() {
    if (errors.applyLocal(inviteFieldErrors({ email }))) return;
    startSending(async () => {
      try {
        const result = await inviteMember({ email, role });
        if (errors.applyResult(result)) return;
        setEmail('');
        onLink(result.link ?? null);
        toast({ title: t('inviteSent') });
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { email, setEmail, role, setRole, sending, send, errors };
}
