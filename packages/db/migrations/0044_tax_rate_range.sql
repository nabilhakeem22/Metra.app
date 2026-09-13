-- 0044 — a ceiling on the VAT rate, on proposals and contracts. SCHEMA ONLY:
-- two CHECK constraints, guarded by a pg_constraint lookup so a re-run is a
-- no-op. No data touched, no backfill, no apply-rls object referenced.
--
-- THE PROBLEM. Every other percentage column in this schema already has a
-- [0,100] CHECK: proposals.discount_pct, proposals.supervision_pct,
-- contracts.retention_pct, contracts.advance_pct. tax_rate — the one that
-- multiplies the whole taxable base — did not. A header save with taxRate
-- '150' was accepted by the validator, priced at 150% VAT by the money engine,
-- and stored. Nothing downstream questioned it: the proposal PDF, the accepted
-- total the client is held to, and the contract generated from it all carried
-- the same wrong number, consistently. Egypt's VAT is 14%; there is no rate
-- above 100% and a negative rate is not a rate.
--
-- The application check (proposals/draft-save-validate.ts, ActionCode
-- 'tax_out_of_range') is the one a user sees. This is the one that holds when
-- the write does not come through that path — a future public-API caller, a
-- migration, a hand-run UPDATE. Both, because either alone is a single point
-- of failure, and this is money.
--
-- VALIDATE, not NOT VALID forever. A pre-flight count of rows outside [0,100]
-- was run against the shared database before this file was written:
--
--   select count(*) from public.proposals where tax_rate < 0 or tax_rate > 100;  -- 0
--   select count(*) from public.contracts where tax_rate < 0 or tax_rate > 100;  -- 0
--
-- Zero on both, so the constraint is added NOT VALID and then VALIDATEd in the
-- same block. To be clear about what that split does NOT buy here: this whole
-- file runs inside the migrator's single transaction, so the ACCESS EXCLUSIVE
-- lock the ADD CONSTRAINT takes is held until that transaction commits — the
-- later VALIDATE's weaker SHARE UPDATE EXCLUSIVE lock cannot downgrade a lock
-- already held. The split is LOCK-NEUTRAL here; it is kept only because it
-- reads as the two distinct steps it is and stays idempotent on a re-run.
-- Had either count been non-zero the VALIDATE would have been dropped and the
-- offending rows reported rather than silently left un-covered.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proposals_tax_rate_range'
  ) THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_tax_rate_range
      CHECK (tax_rate >= 0 AND tax_rate <= 100) NOT VALID;
    ALTER TABLE public.proposals VALIDATE CONSTRAINT proposals_tax_rate_range;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contracts_tax_rate_range'
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_tax_rate_range
      CHECK (tax_rate >= 0 AND tax_rate <= 100) NOT VALID;
    ALTER TABLE public.contracts VALIDATE CONSTRAINT contracts_tax_rate_range;
  END IF;
END $$;
