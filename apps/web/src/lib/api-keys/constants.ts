// Server-safe constants for public API keys. Plain module (NO 'use client', NO
// server-only) so it can be imported by both the server cores and the client
// settings panel without dragging a DB/postgres client into the browser bundle.

/** Max length of a user-supplied API key label. */
export const MAX_API_KEY_LABEL_LEN = 80;
