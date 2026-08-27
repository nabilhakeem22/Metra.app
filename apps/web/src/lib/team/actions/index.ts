// Barrel for the team server-action layer. The single 337-line `actions.ts` was
// split by area (SRP): `invites` (invite/resend/revoke), `members` (change-role /
// remove), and `accept` (accept-invite), over a shared plain `helpers` module (token
// minting, email normalization, link building). Each split action module carries its
// own `'use server';`. This barrel is a PLAIN re-export module (NOT `'use server'`:
// a `'use server'` barrel rejects `export *`/re-exports — the action references
// already live in the split modules) that names the IDENTICAL public surface, so
// every `@/lib/team/actions` import site keeps resolving unchanged. Pure structural
// refactor — no action, signature, or behaviour changed.
export { inviteMember, resendInvite, revokeInvite } from './invites';
export { changeMemberRole, removeMember } from './members';
export { acceptInvite } from './accept';
