# Site updates feed: the seam Stage 3 builds against

Status: CONTRACT ONLY. Nothing in this document is built yet. Stage 3 (the site
diary, "يومية الموقع") implements it; until then no table, function, route or
component named here exists, and nothing reserves them in code.

The client home plan (Oct 23 2026) fixes these names now so the execution step
engine (`apps/web/src/lib/flow/`) and the client's Execution tab can grow a
"latest site updates" strip without reshaping either.

## One item

```ts
interface SiteUpdateItem {
  id: string;
  kind: 'visit' | 'progress' | 'photos' | 'issue' | 'measurement_note';
  occurredAt: string;                      // ISO instant
  authorRole: 'site_engineer' | 'project_manager' | 'owner' | 'admin';   // client side: 'studio' only
  body: string | null;                     // at most 2,000 characters, one language, as typed
  photos: { id: string; width: number | null; height: number | null }[];  // at most 6
  sectionId: string | null;                // optional link to a contract section
  contractLineId: string | null;           // optional link to a contract line
  clientVisible: boolean;                  // default false; the studio releases it
  location?: { lat: number; lng: number; accuracyM: number; onSite: boolean };  // studio only
}
```

- `location` is NEVER part of a client payload, and neither is a member's name.
- Photo bytes are served through a token route in the style of
  `/d/[token]/documents`, stored in R2 (never the 1 GB Supabase Free bucket).
- Engineer notes are never client visible in v1: the client sees only published
  photos with a caption the studio wrote (owner ruling, Oct 25).

## Reading the feed

Studio (an org-scoped read, the `{core,queries,actions}` pattern):

```ts
listSiteUpdates(
  ctx: OrgContext,
  input: { engagementId: string; cursor: string | null; limit: number },  // limit at most 20
): Promise<{ items: SiteUpdateItem[]; nextCursor: string | null }>
```

Client (a reserved SECURITY DEFINER function, locked down like every token SDF):

```sql
app_delivery_site_updates_by_token(p_hash text, p_cursor text, p_limit integer) returns jsonb
```

It returns only `client_visible` rows, never a location and never a member name.

## What the step engine gains

Both inputs are OPTIONAL, so with no site data every step looks exactly as it
does in v1:

- `HomeExecutionFacts.siteActivity?: { lastClientVisibleAt: string | null }` (client)
- `ExecutionStudioFacts.siteActivity?: { lastAt: string | null; openIssues: number }` (studio)

The `works` step reads them to say "last site update X days ago".

## Where it shows

- Cockpit: at most 3 items under the execution step card.
- Client Execution tab: at most 3 client-visible items while the works are in
  progress.
- Each is ONE bounded read (limit 3), made only when the delivery's phase is
  execution.
- The studio is alerted by a notification of kind `site_update_posted`
  (entity type `engagement`), through the existing notifications table.
