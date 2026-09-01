-- 0037 — Per-document comment threads (Client Deliverables, Step 2). SCHEMA ONLY:
-- one APPEND-ONLY table (client asks about ONE released drawing, studio replies
-- under it), its same-org FKs to the engagement AND the artifact, three CHECKs, and
-- two indexes (the per-document thread read, and the per-engagement roll-up that
-- feeds the cockpit's "awaiting your reply" count). No enum, no column added to an
-- existing table. Row-level security and grants (SELECT + INSERT only — a message
-- can never be edited or deleted by either side) live EXCLUSIVELY in
-- rls/policies.sql + rls/roles.sql, so the fresh-DB CI replay (migrate -> apply-rls)
-- stays correct. This migration references NO apply-rls object (no metra_app, no
-- app_* function, no policy). Idempotent, one PL/pgSQL block, short lock_timeout.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);

  -- engagement_document_comments. Cascades from BOTH parents: a thread has no
  -- meaning without its engagement or its document. `author_user_id` is NULL on the
  -- session-less client path (no internal user exists there), where provenance is
  -- carried by author_name / author_ip / author_user_agent instead.
  CREATE TABLE IF NOT EXISTS public.engagement_document_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    engagement_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    author_channel text NOT NULL,
    author_user_id uuid,
    author_name text,
    author_ip text,
    author_user_agent text,
    body text NOT NULL,
    CONSTRAINT engagement_document_comments_org_id_id_unique UNIQUE (org_id, id),
    CONSTRAINT engagement_document_comments_channel_valid
      CHECK (author_channel in ('staff', 'client')),
    -- A client message must never be attributed to an internal user.
    CONSTRAINT engagement_document_comments_client_has_no_user
      CHECK (author_channel <> 'client' or author_user_id is null),
    CONSTRAINT engagement_document_comments_body_length
      CHECK (length(btrim(body)) between 1 and 2000),
    CONSTRAINT engagement_document_comments_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE restrict,
    CONSTRAINT engagement_document_comments_engagement_same_org_fk
      FOREIGN KEY (org_id, engagement_id) REFERENCES public.design_engagements (org_id, id) ON DELETE cascade,
    CONSTRAINT engagement_document_comments_artifact_same_org_fk
      FOREIGN KEY (org_id, artifact_id) REFERENCES public.engagement_artifacts (org_id, id) ON DELETE cascade
  );
  -- The thread read: every message on one document, oldest first.
  CREATE INDEX IF NOT EXISTS engagement_document_comments_artifact_idx
    ON public.engagement_document_comments (org_id, artifact_id, created_at);
  -- The cockpit roll-up: thread counts + the derived awaiting-reply signal.
  CREATE INDEX IF NOT EXISTS engagement_document_comments_engagement_idx
    ON public.engagement_document_comments (org_id, engagement_id);
END $$;
