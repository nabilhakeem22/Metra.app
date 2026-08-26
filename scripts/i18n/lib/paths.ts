/**
 * Canonical filesystem locations and JSON IO for the i18n toolchain. Centralised
 * so every script (translate / validate / review / apply) resolves the same
 * paths relative to the repo root, independent of the current working directory.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestedMessages } from './flatten';

// This file lives in scripts/i18n/lib, so the repo root is three levels up.
const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..', '..');
export const I18N_DIR = resolve(here, '..');
export const MESSAGES_DIR = resolve(REPO_ROOT, 'apps', 'web', 'src', 'messages');

export const EN_PATH = resolve(MESSAGES_DIR, 'en.json');
export const AR_PATH = resolve(MESSAGES_DIR, 'ar-EG.json');
export const AR_GENERATED_PATH = resolve(MESSAGES_DIR, 'ar-EG.generated.json');

export const GLOSSARY_PATH = resolve(I18N_DIR, 'glossary.json');
export const STYLE_GUIDE_PATH = resolve(I18N_DIR, 'style-guide.md');
export const REVIEW_HTML_PATH = resolve(I18N_DIR, 'review.html');

/** Read + parse a JSON message catalog, preserving key order. */
export function readCatalog(path: string): NestedMessages {
  return JSON.parse(readFileSync(path, 'utf8')) as NestedMessages;
}

/** Read a UTF-8 text file. */
export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Write a catalog as pretty JSON with a trailing newline (matches the repo). */
export function writeCatalog(path: string, catalog: NestedMessages): void {
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}
