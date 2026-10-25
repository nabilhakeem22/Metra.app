// The audit entity of a project_assignments row: the assign, the revoke and
// the site access closure (lib/site/close-site-access.ts) all write it. A
// plain constant module, so the closure (imported by the team cores) does not
// load the assignment cores.
export const ASSIGNMENT_AUDIT_ENTITY = 'project_assignment';
