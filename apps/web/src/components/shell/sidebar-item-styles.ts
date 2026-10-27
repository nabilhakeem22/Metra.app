import type { CSSProperties } from 'react';

// The active nav pill: a brand-tinted vertical gradient with a hairline tint
// border. The gradient is a fixed brand wash (reads correctly on both washes);
// the border, text and icon colour track the theme via tokens.
export const ACTIVE_ITEM_STYLE: CSSProperties = {
  background:
    'linear-gradient(180deg, rgba(21,122,110,.20), rgba(21,122,110,.16))',
  border: '1px solid var(--brand-tint-border)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.6)',
  color: 'var(--brand-ink)',
};

// Base geometry shared by every nav row (link, disabled, action, disclosure).
export const ITEM_CLASS =
  'group flex items-center gap-[10px] rounded-item px-[11px] py-[9px] text-body outline-none focus-ring-brand transition-colors motion-reduce:transition-none';
