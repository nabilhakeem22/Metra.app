# Site updates feed: the seam between the site diary and the client home

Status: CONTRACT. The site diary plan (Stage 3, "يومية الموقع", section C4 of
the site-app plan, Oct 23 2026) owns this data and this contract; this page
restates it for the client home lane so both build to one signature and one
shape. If the two ever differ, C4 wins and this page is corrected.

What exists in code today:

- The client SDF `app_delivery_site_updates_by_token` (migration 0064, built
  in S2: `packages/db/src/rls/functions/85-site-portal.sql`).
- `SitePresence` (`apps/web/src/lib/site/presence.ts`, built in S1).

Everything else below (`lib/site/feed/types.ts`, `lib/site/feed/queries.ts`,
`lib/site/feed/client.ts`) is built by the site lane in S7 and S9 under the
names given here.

Everything is keyed by PROJECT: a site visit belongs to a project, and the
client's delivery reaches it through the delivery's project.

## The client's read

```sql
app_delivery_site_updates_by_token(p_hash text, p_before date, p_limit int) returns jsonb
```

- SECURITY DEFINER; the token IS the authorization, resolved by `token_hash`
  exactly like `app_delivery_by_token`. Executable by `metra_app` only.
- Pages by DAY: `p_limit` is a number of days, clamped to 1..14, and null means
  7. Every published visit of a returned day is included, so the `p_before`
  date cursor never splits a day. Newest day first.
- Returns NULL (one null for all three) when the link is not live (unknown,
  revoked or expired), the delivery is not in `execution`, or the project has
  no published visit at all. A `p_before` older than every published day
  returns an empty page, not null.
- Shape:

```json
{
  "updates": [
    {
      "visit_id": "uuid",
      "date": "YYYY-MM-DD",
      "published_at": "timestamptz",
      "caption_ar": "text or null",
      "caption_en": "text or null",
      "photos": [{ "id": "uuid", "display_key": "text", "thumb_key": "text", "width": 0, "height": 0 }]
    }
  ],
  "next_before": "YYYY-MM-DD or null"
}
```

- Rows: only visits with `published_at` set; per visit at most 20 photos, in the
  order taken, and only photos that are `client_visible`, `status = 'stored'`
  and not voided.
- Never in the output or the function source: lat, lng, accuracy, presence,
  distance, any user, any note, any material. The engineer's notes are never
  client visible in v1: the client sees only published photos with a caption
  the studio wrote (owner ruling, Oct 25).
- The object keys never reach the browser. The server reads the SDF through
  `loadClientSiteUpdates` and signs the URLs itself:

```ts
// lib/site/feed/client.ts
loadClientSiteUpdates(
  tokenHash: string,
  before?: string, // YYYY-MM-DD
): Promise<{ updates: SiteUpdateForClient[]; nextBefore: string | null } | null>

// lib/site/feed/types.ts
interface SiteUpdateForClient {
  visitId: string;
  date: string;        // YYYY-MM-DD, Africa/Cairo
  publishedAt: string;
  captionAr: string | null;
  captionEn: string | null;
  photos: { id: string; thumbUrl: string; displayUrl: string; width: number; height: number }[]; // at most 20
}
```

- Signed URLs: TTL 1 hour, no download name, `private, max-age=3600`, signed on
  an hourly window so an `<img>` URL is stable for the hour.
- Photos live in R2, never the 1 GB Supabase Free bucket.
- If the client home ever reads through a token other than the `/d` one, it
  wraps the same SELECT in its own SDF: the JSON shape is the contract.

## The studio's reads

```ts
// lib/site/feed/queries.ts
listStudioSiteFeed(
  ctx: OrgContext,
  input: { projectId: string; before?: string; days?: number }, // days 1..14, default 7
): Promise<ActionResult & { data?: { days: SiteFeedDay[]; nextBefore: string | null } }>

latestSiteActivity(ctx: OrgContext, input: { projectId: string }): Promise<LatestSiteActivity>
```

- `listStudioSiteFeed`: gate `site_diary:read`, and a caller who is a site
  engineer must be assigned to the project. The feed grouped by day (`SiteFeedDay`: the day's visits,
  photos, materials and notes, C4).
- `latestSiteActivity`: one SQL query, for the cockpit's summary line:

```ts
interface LatestSiteActivity {
  lastCheckIn: { at: string; engineerName: string; presence: SitePresence } | null;
  todayPhotoCount: number;
  openIssueCount: number; // issue notes from the last 7 days, not voided
}
```

- A visit's location (`{ lat, lng, accuracyM }`, with `presence: SitePresence`
  and `distanceM`) is studio-only, and only for a role that may read it.

## The alert

An `issue` note inserts one `notifications` row (kind `site_issue`, entity type
`project`) per owner, admin and project manager of the org. `progress` and
`request` notes alert nobody.

## Where the client home meets it

The step engine does not read site data: whose move it is and which step the
job is on come from the contract alone (`apps/web/src/lib/flow/`), so a site
update never moves a rail. The client home lane passes:

- to the execution locators, `ExecutionFlowFacts`
  (`apps/web/src/lib/flow/locate/execution-facts.ts`), the same facts on both
  sides: `locateExecutionForStudio(facts)` and `locateExecutionForClient(facts)`;
- to the site lane, a `projectId` (studio) or the `/d` token's hash (client),
  and nothing else.

The cockpit shows `LatestSiteActivity` beside the execution step card; the
client's Execution tab shows `SiteUpdateForClient` pages while the step is
`works`. Each is one bounded read, made only when the delivery's phase is
execution. With no site data both look exactly as they do without the diary.
