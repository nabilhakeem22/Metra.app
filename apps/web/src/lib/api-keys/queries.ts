import 'server-only';
import { apiKeys } from '@metra/db';
import { desc } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

// Read helper for the settings UI. NEVER selects token_hash — the raw key is
// unrecoverable and the hash is not exposed to any surface.

export interface ApiKeyListRow {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
}

export function listApiKeys(ctx: OrgContext): Promise<ApiKeyListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: apiKeys.id,
        label: apiKeys.label,
        prefix: apiKeys.tokenPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      prefix: r.prefix,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    }));
  });
}
