'use client';

import type { ReactNode } from 'react';

/**
 * The header band every detail tab wears: what this record IS, and the actions
 * that write into it.
 *
 * Each of these actions used to live in one "Log & manage" strip directly under
 * the command card — four equally-weighted options an inch below a card whose
 * whole premise is naming ONE next move. Filing each beside the record it
 * produces is what removes that argument from the page, and it is also the first
 * place the product distinguishes a working file from an attested deliverable:
 * two buttons, side by side, in the Files header.
 *
 * `reason` is the other half of the pattern. An action the studio cannot legally
 * take here stays on the page and EXPLAINS ITSELF rather than disappearing —
 * for a studio in its first week the blocked state is the teaching moment, the
 * one that says the gate is what releases the instalment. Only two situations
 * hide an action instead: it belongs to a branch this engagement is not on, or
 * the signed-in role may not perform it at all.
 *
 * Logical CSS throughout, so the actions sit inline-end in English and
 * inline-start in ar-EG.
 */
export function PanelHeader({
  title,
  sub,
  actions,
  reason,
}: {
  title: string;
  sub?: string;
  /** The tab's own controls. Omitted entirely when the role has none. */
  actions?: ReactNode;
  /** Why the offered action is unavailable — rendered under the band, not in a tooltip. */
  reason?: string;
}) {
  return (
    <div className="border-b border-[color:var(--rule)]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight tracking-[var(--tracking-title)]">
            {title}
          </p>
          {sub && (
            <p className="mt-0.5 text-[12.5px] text-[color:var(--text-muted)]">{sub}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2" style={{ marginInlineStart: 'auto' }}>
            {actions}
          </div>
        )}
      </div>
      {reason && (
        <p
          className="border-t border-[color:var(--rule)] px-4 py-2.5 text-[12.5px] text-[color:var(--text-muted)]"
          style={{ background: 'var(--track)' }}
        >
          {reason}
        </p>
      )}
    </div>
  );
}
