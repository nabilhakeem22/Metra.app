// The "Start delivery" form's fields. A plain module, so the client form, the
// pure rules and the server core share it. `title` is the Arabic/English pair:
// one of them is enough, and the project lends its names when both are empty.
export const ENGAGEMENT_CREATE_FIELDS = ['title', 'clientId', 'projectId'] as const;

export type EngagementCreateField = (typeof ENGAGEMENT_CREATE_FIELDS)[number];
