// Barrel for the project-core surface. The single 303-line `core.ts` was split by
// operation group (SRP): shared `validation` (the `ProjectInput` contract + the
// field/client checks create and update share), `create` (createProjectCore), and
// `update` (updateProjectCore + setProjectActiveCore). This index re-exports the
// IDENTICAL public surface so every `@/lib/projects/core` import site keeps
// resolving unchanged; the validation helpers stay internal. Pure structural
// refactor — no query, type, or behaviour changed.
export type { ProjectInput } from './validation';
export * from './create';
export * from './update';
