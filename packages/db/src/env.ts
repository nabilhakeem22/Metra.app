// Loads the root .env (secrets live there, never in this package) and exposes
// typed getters. Never logs a secret value.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src

// Candidate locations for the root .env, regardless of cwd.
const candidates = [
  resolve(here, '../../../.env'), // repo root from packages/db/src
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
];

for (const path of candidates) {
  if (existsSync(path)) {
    dotenv.config({ path });
    break;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : undefined;
}

/** Session pooler (:5432) — migrations + isolation test. */
export const MIGRATION_DATABASE_URL = () => requireEnv('DATABASE_URL');
/** Transaction pooler (:6543) — runtime client, prepare:false. */
export const RUNTIME_DATABASE_URL = () =>
  optionalEnv('DATABASE_POOL_URL') ?? requireEnv('DATABASE_URL');
