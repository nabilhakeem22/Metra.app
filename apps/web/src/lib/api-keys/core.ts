import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { apiKeys } from '@metra/db';
import { and, eq, isNull } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { MAX_API_KEY_LABEL_LEN } from './constants';
import { API_KEY_PREFIX, API_KEY_PREFIX_LEN } from './resolve';

// Mint/revoke cores for public API keys. Both are gated to the settings
// capability (users_settings/update -> owner/admin) via mutateInOrg, so a
// non-owner/admin session gets `forbidden`. The raw key is returned ONCE from
// mint and never stored or logged — only its sha256 hash + non-secret prefix.

const API_KEY_CAPABILITY = { capability: 'users_settings', action: 'update' } as const;

export interface MintApiKeyInput {
  label: string;
}

export interface MintedApiKey {
  id: string;
  /** The raw `mtk_…` key — shown ONCE, never persisted. */
  rawKey: string;
  prefix: string;
}

function mintRawKey(): { raw: string; hash: string; prefix: string } {
  const raw = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash, prefix: raw.slice(0, API_KEY_PREFIX_LEN) };
}

export async function mintApiKeyCore(
  ctx: OrgContext,
  input: MintApiKeyInput,
): Promise<ActionResult & { data?: MintedApiKey }> {
  const label = input.label?.trim();
  if (!label || label.length > MAX_API_KEY_LABEL_LEN) return err('invalid');

  return mutateInOrg(ctx, API_KEY_CAPABILITY, async (tx, audit) => {
    const { raw, hash, prefix } = mintRawKey();
    const [row] = await tx
      .insert(apiKeys)
      .values({
        orgId: ctx.orgId,
        label,
        tokenHash: hash,
        tokenPrefix: prefix,
        createdBy: ctx.userId,
      })
      .returning({ id: apiKeys.id });

    // The audit trail records the label + prefix only — never the raw key/hash.
    await audit({
      entity: 'api_key',
      entityId: row.id,
      action: 'create',
      before: null,
      after: { label, prefix },
    });
    return { id: row.id, rawKey: raw, prefix };
  });
}

export async function revokeApiKeyCore(
  ctx: OrgContext,
  id: string,
): Promise<ActionResult> {
  return mutateInOrg(ctx, API_KEY_CAPABILITY, async (tx, audit) => {
    // Revoke = stamp revoked_at (never DELETE). Only a live key can be revoked.
    const [row] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });
    if (!row) fail('invalid');

    await audit({
      entity: 'api_key',
      entityId: id,
      action: 'update',
      before: null,
      after: { revoked: true },
    });
  });
}
