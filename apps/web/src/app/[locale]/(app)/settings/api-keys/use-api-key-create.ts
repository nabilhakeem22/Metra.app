'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { mintApiKey } from '@/lib/api-keys/actions';
import { API_KEY_FIELDS, apiKeyFieldErrors } from '@/lib/api-keys/field-rules';
import type { ApiKeyListRow } from '@/lib/api-keys/queries';

/**
 * The create card's label and Create. Create is never disabled to say "not
 * yet": pressing it with no label asks for one under the box. A minted key is
 * handed to `onMinted` (its raw value is shown once) and listed first.
 */
export function useApiKeyCreate(onMinted: (rawKey: string, row: ApiKeyListRow) => void) {
  const te = useTranslations('errors');
  const [label, setLabel] = useState('');
  const [minting, startMint] = useTransition();
  const errors = useFieldErrors({ fields: API_KEY_FIELDS, translate: te });

  function create() {
    if (errors.applyLocal(apiKeyFieldErrors({ label }))) return;
    const trimmed = label.trim();
    startMint(async () => {
      try {
        const result = await mintApiKey({ label: trimmed });
        if (errors.applyResult(result) || !result.data) return;
        const { id, prefix, rawKey } = result.data;
        onMinted(rawKey, {
          id,
          label: trimmed,
          prefix,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          expiresAt: null,
        });
        setLabel('');
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { label, setLabel, create, minting, errors };
}
