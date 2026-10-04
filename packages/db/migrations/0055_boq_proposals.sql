-- 0055 — a delivery's BOQ is built in the proposal builder. SCHEMA ONLY: one new
-- enum type, three columns, constraints and one index. No data touched, no
-- policy, no grant, no apply-rls function referenced, no `ADD VALUE`.
--
-- WHAT IT ADDS.
--   * `proposals.kind` (`quote` | `boq`, default `quote`) and
--     `proposals.engagement_id`. A `boq` proposal is ONE design engagement's BOQ
--     working copy: it is edited in the same builder as a quote and is turned
--     into a real `boqs` document by "Send as BOQ". It is never sent as an offer.
--   * `boqs.source_proposal_id`: the working copy a sent BOQ was cut from.
--     Provenance only, like `source_file_id`.
--
-- THE CHECKS ARE THE SERVER-SIDE LOCK on the quote lifecycle. A `boq` proposal
-- can hold no status but `draft`, no share token, no VAT and no supervision, so
-- the send / accept / expire paths (which all act on `sent`) and the public token
-- SDFs can never reach one, whatever the TypeScript does. `engagement_iff_boq`
-- ties the link to the kind in both directions.
--
-- `proposals_org_engagement_unique` IS NOT PARTIAL, and needs not be: quotes
-- always carry a NULL engagement (the CHECK) and NULLs are distinct, so it reads
-- "one BOQ proposal per engagement". It also serves as the FK's index, which is
-- why `src/schema/proposals.ts` passes `index: false` for `engagement`.
--
-- THE `boqs` FK IS BORN NARROWED. `ON DELETE SET NULL ("source_proposal_id")`,
-- never the bare action: a bare SET NULL on a composite (org_id, x_id) FK nulls
-- org_id too and refuses the parent delete (see 0052's header and
-- `src/schema/org-ref.ts`). The engagement delete cascades to its BOQ proposal,
-- which nulls this reference on an issued BOQ; the immutability trigger's
-- allowlist for that column is in `rls/policies/30-contracts-boqs-variations.sql`.
--
-- NAMES are the exact `sameOrgFk` spellings, camel case DOUBLE-QUOTED so Postgres
-- keeps them (0053's header: an unquoted camelCase name folds to lower case and
-- `migration-catalogue.test.ts` goes red).
--
-- LOCKS. The ADD COLUMNs are metadata-only (a constant default, or none). The two
-- CHECKs and the UNIQUE scan `proposals` (low thousands of rows per org) and the
-- `boqs` FK validates an all-NULL column: well inside the migrator's 3 s
-- lock_timeout. CREATE TYPE then using it in the same file is legal; only
-- `ALTER TYPE ... ADD VALUE` has the commit-before-use rule.
CREATE TYPE "public"."proposal_kind" AS ENUM ('quote', 'boq');
ALTER TABLE "proposals" ADD COLUMN "kind" "proposal_kind" DEFAULT 'quote' NOT NULL;
ALTER TABLE "proposals" ADD COLUMN "engagement_id" uuid;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_engagement_same_org_fk"
  FOREIGN KEY ("org_id","engagement_id") REFERENCES "public"."design_engagements"("org_id","id") ON DELETE CASCADE;
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_org_engagement_unique" UNIQUE ("org_id","engagement_id");
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_engagement_iff_boq"
  CHECK ((kind = 'boq') = (engagement_id IS NOT NULL));
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_boq_unpriced_draft"
  CHECK (kind = 'quote' OR (status = 'draft' AND token_hash IS NULL AND tax_rate = 0 AND supervision_pct = 0));
ALTER TABLE "boqs" ADD COLUMN "source_proposal_id" uuid;
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_sourceProposal_same_org_fk"
  FOREIGN KEY ("org_id","source_proposal_id") REFERENCES "public"."proposals"("org_id","id")
  ON DELETE SET NULL ("source_proposal_id");
CREATE INDEX "boqs_sourceProposal_idx" ON "boqs" USING btree ("org_id","source_proposal_id");
