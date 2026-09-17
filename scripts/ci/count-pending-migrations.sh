#!/usr/bin/env bash
#
# How many migrations would ONE `db:migrate` transaction apply for this push?
#
# `db:migrate` runs every PENDING migration as a SINGLE transaction, so the
# ACCESS EXCLUSIVE window is the sum of the batch, not of one file. 0049 + 0050
# measured ~630 ms against the migrator's own `lock_timeout = 3s`
# (packages/db/src/scripts/lock-timeout.ts) - a ~4.8x self-abort margin. Ten DDL
# migrations in one batch would not fit it. This bounds the batch.
#
# WHAT IT COUNTS: the `.sql` files under `packages/db/migrations` that THIS PUSH
# ADDS - i.e. the batch a single deploy of this ref would apply. What it cannot
# see is the target database's `drizzle.__drizzle_migrations`, so anything merged
# but not yet applied by the lead is part of the real pending batch and is not
# counted here. The lead's pre-merge `assert-schema-applied` run is where that is
# knowable; this is the cheap fence that stops a branch from proposing ten.
#
# WHICH BASE, and why it is not one rule:
#
#   push to main    `github.event.before` - the PREVIOUS main tip. The old code
#                   used `git merge-base origin/main HEAD`, which on a main push
#                   is HEAD itself, so the count was ALWAYS 0 and pushes to main
#                   were structurally ungated. A squash merge that lands four
#                   migrations went green by construction.
#   anything else   `git merge-base origin/main HEAD` - the branch delta, which
#                   is what a reviewer is being asked to approve.
#
# It NEVER exits 128. A base that is absent, all-zeroes (the first push of a
# branch, or a force-created ref) or simply not in this clone falls back to
# `HEAD~1` with a `::warning::`, and a root commit with no parent counts 0. The
# old code ran `git merge-base` bare, so a missing ref aborted the job with
# `fatal: Not a valid object name` - loud, but a 128 nobody can act on.
#
# Environment (all optional; the defaults are what a local dry run wants):
#   MAX_PENDING_MIGRATIONS  the bound. Above it, `::error::` and exit 1.
#   EVENT_NAME / REF_NAME / BEFORE_SHA   github.event_name / ref_name / before.
#   GITHUB_STEP_SUMMARY     appended to when set.
set -euo pipefail

MAX_PENDING_MIGRATIONS="${MAX_PENDING_MIGRATIONS:-4}"
EVENT_NAME="${EVENT_NAME:-}"
REF_NAME="${REF_NAME:-}"
BEFORE_SHA="${BEFORE_SHA:-}"
ZERO_SHA='0000000000000000000000000000000000000000'

if [ "$EVENT_NAME" = "push" ] && [ "$REF_NAME" = "main" ]; then
  base="$BEFORE_SHA"
  base_kind='github.event.before (previous main tip)'
else
  git fetch --no-tags --quiet origin main || true
  base="$(git merge-base origin/main HEAD 2>/dev/null || true)"
  base_kind='merge-base with origin/main'
fi

if [ -z "$base" ] || [ "$base" = "$ZERO_SHA" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "::warning::migration batch size: no usable base (${base_kind} gave '${base:-empty}') - falling back to HEAD~1. The count below covers the LAST COMMIT ONLY."
  base="$(git rev-parse --verify --quiet 'HEAD~1' || true)"
  base_kind='HEAD~1 (fallback)'
fi

if [ -z "$base" ]; then
  echo "::warning::migration batch size: HEAD has no parent either - counting 0."
  count=0
else
  count="$(git diff --name-only --diff-filter=A "$base" HEAD -- packages/db/migrations | grep -c '\.sql$' || true)"
fi

line="pending migrations: $count / $MAX_PENDING_MIGRATIONS (base: $base_kind)"
echo "$line"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  # Best-effort: a summary that cannot be written must never fail an under-budget run.
  echo "$line" >> "$GITHUB_STEP_SUMMARY" || echo "::warning::could not append to GITHUB_STEP_SUMMARY"
fi

if [ "$count" -gt "$MAX_PENDING_MIGRATIONS" ]; then
  echo "::error::$line - one db:migrate transaction would hold ACCESS EXCLUSIVE for the whole batch. Split the merge, or raise MAX_PENDING_MIGRATIONS in the same commit that explains why."
  exit 1
fi
