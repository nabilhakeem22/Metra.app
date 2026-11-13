# Round D Wave 3 (the client page's consent guard): the deploy and its smoke test

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

Wave 3 is app code only: no migration, no `apply-rls`. It is the code the 0059
step above was for, so it merges ONLY after that step's step 4 matched and
`validate/round-d-db` is on `main`. Merged before it, every review act on the
client page fails with 42883 and the receipts disappear (see THE ORDER above).

**What changes on the client page.**

- Every design decision and every budget confirmation names the issuance the
  client's page showed (the render round, the budget band). The database
  refuses one whose issuance is no longer on file ("this changed, please look
  again") and saves nothing. No check runs in the app before the write any more.
- Approve the design together with the budget is two consents, each judged on
  its own issuance (owner decision): a band re-issued after the page loaded
  saves the design approval and tells the client their budget confirmation
  was not recorded; new renders with the same band save the budget
  confirmation alone and ask for the design again; both changed saves neither.
  Each line the client reads about the budget talks about the budget only.
- A render the studio shows the client while the client has NOT yet answered
  the final design (at the final approval, or during an as-built triage)
  starts a new round: an approval taken on the page from before it is
  refused. Once the client has approved (or asked for changes), a render shown
  later leaves that decision standing (owner decision).
- The payments card lists the payments received from their own list (up to
  200, with a note when there are more), not from the dated timeline.
- Settings: "+20 00 10 ..." is saved as `+2010...` (every extra trunk zero
  dropped), and a line or paragraph separator inside InstaPay, the bank name or
  the account holder is refused.

**What the studio sees.** When the design is approved but the client's budget
confirmation was refused because the band changed after their page loaded,
the design notification (bell and email) adds that the client has not
acknowledged the budget range yet. The cockpit's "Budget range acknowledged"
guard stays open until the client confirms it.

**Smoke test, right after the Deploy workflow is green (owner, 5 minutes).**
This run is ALSO the only proof that an issuance instant crosses Cloudflare's
Hyperdrive with its microseconds intact: the tests prove the app, drizzle and
Postgres, not the Hyperdrive hop. Use one of the studio's own TEST deliveries,
never a client's:

1. In the cockpit, take the test delivery to the final approval with renders
   shared, and issue a budget range.
2. Open its client link in a private window, freshly loaded. The design card
   offers Approve, and its confirmation says it also confirms the budget range.
3. Approve. Expected on the client page: "Design approved" and "You also
   confirmed seeing the budget range." Expected in the cockpit: the design
   approved AND "Budget range acknowledged" ticked, and the bell shows the
   approval without a budget sentence.
4. While it runs, watch the logs from `apps/web`:

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler tail metra-web
```

**Reading the result.** Production runs on the Workers Free plan, so a request
can now and then stop with "exceeded CPU" (error 1102) or a "something went
wrong" page. That is a RETRY, not a failure: reload the page and approve again
(a repeat tap is safe; it never records twice).

**Roll back only on one of these three:**

- a `42883` in the log (the database step is missing: the code calls a
  function that does not exist);
- step 3 answers "this changed, please look again" on a page you loaded fresh
  in step 2 (the instant did not survive the trip: every act on every client
  page would answer the same);
- a log line starting `approve design with budget:`.

Then roll the Worker back at once and tell the lead what you saw. Leave the
database alone. Rolling back to any version below this deploy is safe on the
0059 database (until 0060): the six-argument respond function the older code
calls stays until the next database step. Once 0060 has run, this deploy is
the oldest version a rollback may pick ([*0060 and the Round E database step*](0060-round-e.md)).
Pick the version by its id (see *Rolling back*):

```powershell
cd C:\Users\HP\merta-main\apps\web
npx wrangler deployments list
npx wrangler rollback <version-id>
```

**Before the next database step (read-only, owner).** The CHECK that refuses
`+200` numbers waits for this count. Anything above 0 is a studio number saved
before Wave 3. To fix one, the studio's owner or an admin opens Settings,
CLEARS the number and saves, then types it again and saves. (Saving without a
change sends nothing: the sheet sends only the boxes that differ from what it
opened with, and typing the same digits back is no difference.)

```sql
select count(*) as plus_200_numbers
  from public.organizations
 where studio_phone ~ '^\+200' or studio_whatsapp ~ '^\+200';
```
