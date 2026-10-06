// PURE and client-safe. The six tones every status chip in the app speaks.
// Brand is reserved for `yourMove` (the studio holds the next step); red is
// never a status, it means an error or a destructive action.
export type StatusTone = 'yourMove' | 'waiting' | 'stalled' | 'done' | 'draft' | 'neutral';
