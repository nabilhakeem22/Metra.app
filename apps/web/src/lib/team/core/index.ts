// Barrel for the team cores. The single 185-line `core.ts` was split by
// mutation: `change-member-role`, `remove-member` and `accept-invite`, with the
// shared opening of the first two in `membership-target`. Every
// `@/lib/team/core` import site keeps resolving unchanged.
//
// PURE cores for the team mutations — no next/*, no getSessionUser, no cookies,
// no server-only. Take an OrgContext + validated input; the 'use server'
// wrappers in ./actions do requireOrg()/cookie/token work and delegate here.
// These are exercised directly (no Next layer) by tests/actions/*.dbtest.ts.
export { changeMemberRoleCore } from './change-member-role';
export { removeMemberCore } from './remove-member';
export { acceptInviteCore } from './accept-invite';
