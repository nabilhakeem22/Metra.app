'use client';

import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { useClientVisibility } from './use-client-visibility';

/**
 * Client Deliverables, Step 1 — the shared "is this file on the client portal?"
 * control: a status pill plus, for a caller who may change it, the flip button.
 * Rendered by BOTH the working-files tray and the artifact table so the two
 * surfaces read identically.
 *
 * The caller owns the shared hook (one instance per surface) and passes it in, so
 * every row on a surface shares one saving state. Read-only callers still see the
 * pill — knowing whether the client can see a file is not a privileged fact inside
 * the studio. Logical CSS only.
 */
export function ArtifactVisibilityControl({
  artifactId,
  clientVisible,
  canManage,
  visibility,
}: {
  artifactId: string;
  /** The stored value; the hook overlays an optimistic one after a toggle. */
  clientVisible: boolean;
  canManage: boolean;
  visibility: ReturnType<typeof useClientVisibility>;
}) {
  const t = useTranslations('engagements.files.visibility');
  const visible = visibility.isVisible(artifactId, clientVisible);
  const saving = visibility.savingId === artifactId;

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center gap-1 rounded-[var(--r-icon)] px-2 py-0.5 text-[11px] font-semibold ${
          visible
            ? 'bg-brand-tint text-brand-ink'
            : 'bg-[color:var(--rule)] text-[color:var(--text-muted)]'
        }`}
      >
        {visible ? (
          <Eye className="size-3" aria-hidden />
        ) : (
          <EyeOff className="size-3" aria-hidden />
        )}
        {visible ? t('visible') : t('hidden')}
      </span>

      {canManage && (
        <button
          type="button"
          onClick={() => visibility.toggle(artifactId, !visible)}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-[var(--r-icon)] px-2 py-1 text-[12px] font-semibold text-[color:var(--text-muted)] hover:bg-brand-tint hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {saving ? t('saving') : visible ? t('hide') : t('show')}
        </button>
      )}
    </span>
  );
}
