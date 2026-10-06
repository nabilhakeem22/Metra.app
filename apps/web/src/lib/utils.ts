import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind.config.ts REPLACES the font-size and border-radius scales with the
// design tokens. tailwind-merge only knows Tailwind's default names, so without
// this it reads `text-caption` as a text COLOUR and `cn('text-caption',
// 'text-muted-foreground')` silently drops the size. Every radius side group
// the repo uses is listed too, so `rounded-e-item` / `rounded-e-panel` conflict.
const TYPE_TOKENS = ['caption', 'small', 'body', 'title', 'heading', 'display'];
const RADIUS_TOKENS = ['item', 'panel', 'frame', 'pill'];
const RADIUS_SIDES = ['s', 'e', 't', 'b', 'ss', 'se', 'es', 'ee'] as const;

const radiusSideGroups = Object.fromEntries(
  RADIUS_SIDES.map((side) => [`rounded-${side}`, [{ [`rounded-${side}`]: RADIUS_TOKENS }]]),
);

const mergeClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TYPE_TOKENS }],
      rounded: [{ rounded: RADIUS_TOKENS }],
      ...radiusSideGroups,
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}
