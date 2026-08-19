'use server';

import { requireOrg } from '@/lib/auth/require-org';
import { type ActionResult } from '@/lib/actions/result';
import { mintApiKeyCore, revokeApiKeyCore, type MintedApiKey } from './core';

// Thin server-action wrappers over the mint/revoke cores. requireOrg resolves the
// session context; the cores gate the settings capability (owner/admin) and audit.

export async function mintApiKey(input: {
  label: string;
}): Promise<ActionResult & { data?: MintedApiKey }> {
  const ctx = await requireOrg();
  return mintApiKeyCore(ctx, input);
}

export async function revokeApiKey(id: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  return revokeApiKeyCore(ctx, id);
}
