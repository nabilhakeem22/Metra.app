// The client-core surface: create, and the two updates. Split by operation the
// way `lib/projects/core` is, so every `@/lib/clients/core` import resolves
// unchanged. The rules they share live in ../field-rules (pure, client-safe).
export type { ClientInput } from '../fields';
export * from './create';
export * from './update';
