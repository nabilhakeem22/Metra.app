import type { ComponentType } from 'react';

// Decorative line icons for the feature cards. Stroke inherits `currentColor`
// (white on the brand-gradient tile). All are aria-hidden — the adjacent
// heading carries the meaning.
const baseProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function FlowIcon() {
  return (
    <svg {...baseProps}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

export function CostIcon() {
  return (
    <svg {...baseProps}>
      <path d="M12 2v20M6 6h9a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h10" />
    </svg>
  );
}

export function ProposalsIcon() {
  return (
    <svg {...baseProps}>
      <path d="M4 4h16v12H7l-3 3z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}

export function BilingualIcon() {
  return (
    <svg {...baseProps}>
      <path d="M3 5h13M3 12h13M3 19h9" />
      <path d="M20 8l-3 4 3 4" />
    </svg>
  );
}

export type FeatureIcon = ComponentType;
