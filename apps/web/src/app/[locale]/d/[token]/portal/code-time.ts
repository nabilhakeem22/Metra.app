// How the code panel says a wait. PURE and CLIENT-SAFE. Latin digits only.

/** A resend countdown, `M:SS`, from whole seconds (never below 0:00). */
export function countdownText(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * A limit's wait, rounded UP so the client never comes back early: minutes
 * under two hours, else hours. `unit` picks the plural copy
 * (`delivery.code.wait.minutes` or `.hours`), `count` its number.
 */
export function waitUnit(seconds: number): { unit: 'minutes' | 'hours'; count: number } {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes < 120 ? { unit: 'minutes', count: minutes } : { unit: 'hours', count: Math.ceil(minutes / 60) };
}
