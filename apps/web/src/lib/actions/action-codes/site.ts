// Error codes of the site diary (Stage 3): the engineer's app and its /api/site
// routes, assignments, the site pin, photos and diary entries. Pure (no
// server-only deps). The full union is `ActionCode` in `lib/actions/result.ts`.
// The HTTP status each one answers with is the site API's map (plan C3), which
// the phone's outbox depends on.
export type SiteActionCode =
  // 401: the request carries no live session.
  | 'unauthorized'
  // 401: an owner or admin signed this phone (its session) out of the workspace.
  | 'device_revoked'
  // 403: the account holds no internal membership in the workspace (the caller,
  // or the member being assigned).
  | 'not_member'
  // 403: a site engineer writing on a project he is not assigned to.
  | 'not_assigned'
  // 404: no such project in the workspace.
  | 'project_not_found'
  // 404: no visit with that key (or id) in the workspace.
  | 'visit_not_found'
  // 404: no photo, material or note (or assignment, or device) with that key.
  | 'entry_not_found'
  // 409: the visit is past the 2 days an engineer may add to or void in.
  | 'visit_too_old'
  // 409: the visit already holds the 20 live photos it may.
  | 'visit_photo_limit'
  // 409: confirm found no uploaded object; the phone presigns again.
  | 'photo_not_uploaded'
  // 422: an uploaded photo over its cap, or not the size it declared; the phone
  // also says it of a photo its compression cannot bring under the cap.
  | 'photo_too_large'
  // 409: the workspace has used its photo storage quota.
  | 'site_storage_full'
  // 409: an engineer setting a pin on a project that already has one.
  | 'site_pin_exists'
  // 409: voiding an entry that is already void.
  | 'entry_already_void'
  // 409: voiding a photo the client is shown.
  | 'entry_published'
  // 409: a check-in with a location fix but no live consent to share it.
  | 'location_consent_required'
  // Never from the server: the phone refuses a capture while 200 photos wait to upload.
  | 'outbox_full'
  // Never from the server: the phone could not decode the photo it was given.
  | 'photo_unreadable';
