// Which field of the contact form a server refusal belongs under. PURE (no
// React, no 'use client'), so it is tested without a sheet.
import type { ActionCode } from '@/lib/actions/result';

/** Where a refusal is shown: under the name, or above the footer. */
export type ContactFormField = 'name' | 'form';

export function contactFieldFor(code: ActionCode): ContactFormField {
  return code === 'name_required' ? 'name' : 'form';
}
