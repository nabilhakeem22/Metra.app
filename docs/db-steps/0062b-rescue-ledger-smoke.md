# The rescue ledger and the studio read budgets (PR BR): smoke test

Split out of the [deployment runbook](../DEPLOY.md) on 2026-11-13; the text is unchanged apart
from links to sibling files. A section name in italics that is not in this file is a section
of that document, or a sibling file in this folder.

No database step. The deploy adds two Rate Limiting bindings, which
`wrangler deploy` creates from `apps/web/wrangler.jsonc`:
`STUDIO_READ_RATE_LIMITER` (namespace 1005, 30 per 60 s: the rescue ledger
route) and `STUDIO_SEARCH_RATE_LIMITER` (namespace 1006, 120 per 60 s: the
contract line picker, the price book picker and the market prices search).
Each is keyed per surface, workspace and member.

**Smoke test, right after the Deploy workflow is green (owner, 3 minutes),**
with `npx wrangler tail metra-web` open in a terminal (from `apps/web`):

1. Open the dashboard as the owner. The Rescue ledger block renders below the
   charts, with its cards and both monthly charts (zeros are fine on a quiet
   studio). A "We could not load the ledger" card instead is a failure.
2. Do one picker search: in a draft proposal's builder, open "From price book"
   and type a word. Matches (or "no matches") come back; a "Too many requests"
   line on the first search is a failure.
3. Read the tail. It must show NO line containing `limiter missing`. Such a
   line names the binding the deployed Worker lacks: the surface is refusing
   every request, and the fix is a redeploy with `wrangler.jsonc` intact.
