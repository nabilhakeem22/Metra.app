// The audit entity of a project_assignments row: the assign, the revoke and
// the member-removal cascade all write it. A plain constant module, so the
// cascade (imported by the team cores) does not load the assignment cores.
export const ASSIGNMENT_AUDIT_ENTITY = 'project_assignment';
