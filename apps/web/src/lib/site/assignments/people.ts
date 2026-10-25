import 'server-only';
// A site team member's name (and, for a manager, his email) lives in Supabase
// auth, so each is looked up by user id: cached per isolate and bounded by a
// deadline (lib/team/actor-identity.ts), a failed lookup leaves him unnamed.
// One lookup is one subrequest, so every caller passes a bounded list (the
// first SITE_TEAM_LIST_LIMIT of a team, one candidate page).
import type { MemberRole } from '@/lib/permissions/roles';
import { lookupActorIdentity } from '@/lib/team/actor-identity';
import type { SiteTeamPerson } from './types';

/** Each member named, with his email only when `withEmail` (the viewer manages the site team). */
export async function withIdentities<T extends { userId: string; role: MemberRole }>(
  members: readonly T[],
  { withEmail }: { withEmail: boolean },
): Promise<Array<T & SiteTeamPerson>> {
  return Promise.all(
    members.map(async (member) => {
      const identity = await lookupActorIdentity(member.userId);
      return { ...member, name: identity.name, email: withEmail ? identity.email : null };
    }),
  );
}
