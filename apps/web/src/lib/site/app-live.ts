// Is the site app's shell (/{locale}/site, PR S4) deployed? The sign-in landing
// on it is built and tested now (PR S3, plan C3 "Post-login") but switched
// off until the page it lands on exists: with this false, nobody is sent to a
// /site that would answer 404. PR S4 deletes this flag with the shell.
export const SITE_APP_LIVE = false;
