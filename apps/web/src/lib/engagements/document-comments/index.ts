// Barrel for the studio half of the document threads. The single 190-line
// `document-comments.ts` was split by job: `thread` (read one document's thread),
// `reply` (append a studio reply) and `awaiting-reply` (the unanswered-message
// count). Every `@/lib/engagements/document-comments` import site keeps resolving
// unchanged.
//
// Client Deliverables, Step 2 — the STUDIO half of per-document comment threads.
// The client writes through the token SDF (`app_delivery_comment_by_token`); this
// module is what the cockpit uses: read one document's thread, and reply into it.
//
// Self-contained `*Core(ctx, input)` (API-ready), gated on the §2.2
// `engagements_design` cell — `read` for the thread, `update` for a reply (the same
// cell that governs every other studio write on an engagement). The thin
// `'use server'` wrappers live in ../actions/deliverables.ts.
//
// ADVISORY: replying moves no state, opens no change order and clears no guard. A
// thread is a conversation attached to a drawing, not a step in the machine.
export * from './thread';
export * from './reply';
export * from './awaiting-reply';
