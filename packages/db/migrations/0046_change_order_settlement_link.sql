-- 0046 — which payment settled which change order. SCHEMA ONLY: one nullable
-- column, one composite same-org FK, one index. Additive and idempotent, no
-- backfill, no apply-rls object referenced.
--
-- THE PROBLEM. `engagement_change_orders.status` went `raised` -> `settled` and
-- `settled_at` recorded WHEN, but nothing recorded BY WHAT. The settle path
-- matches raised change orders against `revision_co` payments by amount, so
-- after the fact there was no way to answer "which payment paid for this change
-- order" — not for a client dispute, not for an auditor, and not for the guard
-- that has to decide whether a newly raised change order is already covered by
-- credit the client has paid.
--
-- NO BACKFILL. Change orders settled before this migration were matched by
-- amount and clearing order, and that mapping is not recoverable
-- deterministically (two 5000 change orders and two 5000 payments have no
-- distinguishable pairing). Legacy rows therefore keep a NULL link, which is
-- why there is no CHECK requiring settled => link is not null: it would be
-- false for exactly those rows.
--
-- The FK is the composite (org_id, settled_by_payment_event_id) ->
-- payment_events (org_id, id) that every same-org reference in this schema
-- uses, so a change order can never point at another tenant's payment.
-- ON DELETE set null: the ledger is append-only in practice, but if a payment
-- row ever goes the change order must stay settled rather than be deleted with
-- it. Grants are unchanged — roles.sql already grants select, insert, update on
-- this table.
ALTER TABLE public.engagement_change_orders ADD COLUMN IF NOT EXISTS settled_by_payment_event_id uuid;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'engagement_change_orders_settledByPaymentEvent_same_org_fk') THEN
  ALTER TABLE public.engagement_change_orders ADD CONSTRAINT engagement_change_orders_settledByPaymentEvent_same_org_fk
    FOREIGN KEY (org_id, settled_by_payment_event_id) REFERENCES public.payment_events (org_id, id) ON DELETE set null;
END IF; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagement_change_orders_settledByPaymentEvent_idx" ON public.engagement_change_orders (org_id, settled_by_payment_event_id);
