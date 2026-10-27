// How the code panel says a wait. PURE and CLIENT-SAFE. Latin digits only.

/**
 * A wait as the panel words it (H5 functional F4): under an hour a ticking
 * `M:SS` clock; from an hour on, whole hours and minutes, rounded UP to the
 * minute so the client never comes back early (never "1319:54").
 */
export type WaitParts = { kind: 'clock'; text: string } | { kind: 'hours'; hours: number; minutes: number };

const HOUR = 3600;

export function waitParts(seconds: number): WaitParts {
  const whole = Math.max(0, Math.ceil(seconds));
  if (whole < HOUR) return { kind: 'clock', text: `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}` };
  const minutes = Math.ceil(whole / 60);
  return { kind: 'hours', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
