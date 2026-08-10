// Shared animation class tokens, always reduced-motion aware. Prefer these so
// motion stays consistent and respects prefers-reduced-motion everywhere.
export const motion = {
  fade: 'transition-opacity duration-200 ease-out motion-reduce:transition-none',
  pop: 'transition-all duration-200 ease-out motion-reduce:transition-none',
  enter:
    'animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none',
  overlay: 'animate-in fade-in-0 duration-200 motion-reduce:animate-none',
} as const;

export type MotionToken = keyof typeof motion;
