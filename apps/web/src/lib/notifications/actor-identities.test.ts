import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from '@/components/notifications/feed-item';

vi.mock('server-only', () => ({}));
const lookup = vi.hoisted(() => ({ lookupActorIdentity: vi.fn() }));
vi.mock('@/lib/team/actor-identity', () => lookup);

import { withActorIdentities } from './actor-identities';

const ACTOR = '11111111-1111-4111-8111-111111111111';

function item(kind: string, params: Record<string, unknown>): FeedItem {
  return { id: kind, kind, bodyKey: kind, params, entityType: null, entityId: null, createdAt: '2026-10-10T05:00:00Z', read: false };
}

beforeEach(() => lookup.lookupActorIdentity.mockReset());

describe('withActorIdentities (S1)', () => {
  it('resolves each actor once and attaches who they are', async () => {
    lookup.lookupActorIdentity.mockResolvedValue({ name: 'Sara', email: 'sara@studio.test' });
    const items = await withActorIdentities([
      item('client_page_details_changed', { actorUserId: ACTOR }),
      item('client_page_details_changed', { actorUserId: ACTOR, fields: ['bankIban'] }),
    ]);
    expect(lookup.lookupActorIdentity).toHaveBeenCalledTimes(1);
    expect(items.map((entry) => entry.params.actor)).toEqual([
      { name: 'Sara', email: 'sara@studio.test' },
      { name: 'Sara', email: 'sara@studio.test' },
    ]);
  });

  it('leaves every other kind, and a malformed actor id, untouched without a lookup', async () => {
    const others = [item('stage_reminder', { actorUserId: ACTOR }), item('client_page_details_changed', { actorUserId: 'nope' })];
    expect(await withActorIdentities(others)).toEqual(others);
    expect(lookup.lookupActorIdentity).not.toHaveBeenCalled();
  });
});
