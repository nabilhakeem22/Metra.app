// Shared animation class tokens, always reduced-motion aware. Prefer these so
// motion stays consistent and respects prefers-reduced-motion everywhere.
// Motion is transform/opacity only (never width/top/left) per the Snap Line spec.
export const motion = {
  fade: 'transition-opacity duration-200 ease-out motion-reduce:transition-none',
  pop: 'transition-all duration-200 ease-out motion-reduce:transition-none',
  enter:
    'animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none',
  overlay: 'animate-in fade-in-0 duration-200 motion-reduce:animate-none',
  /** Tactile button press — scale down slightly on :active. */
  press:
    'transition-transform duration-100 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100',
  /** Row hover feedback. */
  hoverRow: 'transition-colors duration-150 hover:bg-muted motion-reduce:transition-none',
  /** First-load stagger entrance. Set inline `style={{ '--i': n }}` for delay. */
  entrance: 'stagger-in',
} as const;

export type MotionToken = keyof typeof motion;
