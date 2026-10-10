import 'server-only';
// Who a "client page details changed" notification is about, resolved when the
// feed is read (Round C, C8 fix round S1). The stored row carries only the
// actor's user id, never a name: the feed shows their VERIFIED auth email with
// their cleaned display name beside it (lib/team/actor-identity.ts), so a name
// changed afterwards, or one chosen to impersonate a colleague, cannot speak for
// the account that made the change.
import type { FeedItem } from '@/components/notifications/feed-item';
import { lookupActorIdentity } from '@/lib/team/actor-identity';
import { isUuid } from '@/lib/uuid';

const RESOLVED_KINDS: ReadonlySet<string> = new Set(['client_page_details_changed']);

/**
 * The items, each resolved one carrying `params.actor = { name, email }`. One
 * lookup per distinct actor; a lookup that fails leaves `actor` empty, and the
 * line then names nobody. Never throws.
 */
export async function withActorIdentities(items: FeedItem[]): Promise<FeedItem[]> {
  const actorIds = [
    ...new Set(
      items
        .filter((item) => RESOLVED_KINDS.has(item.kind) && isUuid(item.params.actorUserId))
        .map((item) => item.params.actorUserId as string),
    ),
  ];
  if (actorIds.length === 0) return items;
  const identities = new Map(
    await Promise.all(actorIds.map(async (id) => [id, await lookupActorIdentity(id)] as const)),
  );
  return items.map((item) => {
    const identity = RESOLVED_KINDS.has(item.kind) ? identities.get(item.params.actorUserId as string) : undefined;
    return identity ? { ...item, params: { ...item.params, actor: identity } } : item;
  });
}
