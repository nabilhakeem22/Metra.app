// Shared argument and environment reading for the market CLI commands.
import { PERIOD_PATTERN } from '../guard';

export function requirePeriod(period: string | undefined): string {
  if (period === undefined || !PERIOD_PATTERN.test(period)) {
    throw new Error('--period YYYY-MM is required, e.g. --period 2026-07');
  }
  return period;
}

export function requireText(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim() === '') throw new Error(`${flag} "<text>" is required`);
  return value.trim();
}

const DEFAULT_FLAG_PCT = 15;

/** F1's threshold: MARKET_FLAG_PCT, a positive percentage, default 15. */
export function flagPctFromEnv(): number {
  const configured = process.env.MARKET_FLAG_PCT;
  if (configured === undefined || configured.trim() === '') return DEFAULT_FLAG_PCT;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(configured.trim()) || Number(configured) <= 0) {
    throw new Error(`MARKET_FLAG_PCT must be a positive number, found "${configured}"`);
  }
  return Number(configured);
}
