#!/usr/bin/env node
/**
 * Fail the build if the repository's Markdown has drifted back into a state a
 * decision already closed.
 *
 * Three rules, each of which was a real regression rather than a hypothetical:
 *
 *   1. ROOT `DEPLOY.md` MUST NOT EXIST. Owner decision 9 put the deploy runbook
 *      at `docs/DEPLOY.md` and nowhere else. Wave 0 deleted the root copy; wave
 *      2 recreated it as an 8-line pointer; nothing in the repo noticed either
 *      time. A decision enforced by memory, whose failure is silent, is not a
 *      decision — the same argument `ci.yml`'s own header makes about the
 *      `validate/**` trigger.
 *
 *   2. NO `vercel` IN ANY TRACKED `*.md`, except `docs/BUILD-LOG.md`. The app
 *      moved to Cloudflare Workers in August 2026, so a document that sends an
 *      owner to a Vercel dashboard sends them somewhere that reaches nothing.
 *      `docs/BUILD-LOG.md` is exempt BY NAME because it is a HISTORY: its
 *      "deployed to Vercel" sentence was true when it was written, and
 *      falsifying a build log to make a grep go green is the worst possible way
 *      to pass a check.
 *
 *   3. NO EM/EN DASH INSIDE ARABIC PROSE. Mirrors
 *      `scripts/i18n/lib/validator.ts:29`, which enforces exactly this on the
 *      JSON catalogues and has no reach into Markdown. The dash is not Arabic
 *      punctuation; its presence is the clearest single signal that a string
 *      was written in English and carried across unchanged.
 *
 *      The rule is STRICT ON PURPOSE: the dash only offends when the nearest
 *      NON-WHITESPACE neighbour on BOTH sides is an Arabic-script character.
 *      A looser "Arabic somewhere on the line" test matches four legitimate
 *      lines in the tree today (`stack-profile.md:7`,
 *      `scripts/i18n/style-guide.md:30,31,129`), all of which are an English
 *      sentence that happens to contain an Arabic term — and would have made
 *      this gate red on its first run. Expected count today: 0. This is a
 *      RATCHET, not a cleanup.
 *
 * No dependency: `node:child_process` (`git ls-files`) + `node:fs`.
 * Run it with `npm run docs:check`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The one file allowed to say "Vercel", because it is a history. */
const VERCEL_EXEMPT = 'docs/BUILD-LOG.md';

/** The runbook path decision 9 settled on. */
const RUNBOOK = 'docs/DEPLOY.md';

/**
 * An em or en dash whose nearest non-whitespace neighbour on BOTH sides is an
 * Arabic-script character. `\s*` cannot span a non-whitespace character, so any
 * Latin letter, bracket or backtick between the dash and the Arabic run makes
 * this not match — which is precisely the near-miss carve-out described above.
 */
const ARABIC_DASH = /[؀-ۿ]\s*[–—]\s*[؀-ۿ]/u;

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
}

function trackedMarkdown(root) {
  return execFileSync('git', ['ls-files', '*.md'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** @returns {string[]} one human-readable failure per offending line. */
function checkRootRunbook(files) {
  if (!files.includes('DEPLOY.md')) return [];
  return [
    'DEPLOY.md:1  Owner decision 9: the deploy runbook lives at ' +
      `${RUNBOOK} and nowhere else. A runbook that exists twice is a ` +
      'runbook that is wrong in one place. Delete the root copy.',
  ];
}

function checkVercel(root, files) {
  const failures = [];
  for (const file of files) {
    if (file === VERCEL_EXEMPT) continue;
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!/vercel/i.test(line)) return;
      failures.push(
        `${file}:${index + 1}  mentions Vercel. The app runs on Cloudflare ` +
          `Workers (worker metra-web); see ${RUNBOOK}. Only ` +
          `${VERCEL_EXEMPT} may say this, because it is a history.`,
      );
    });
  }
  return failures;
}

function checkArabicDashes(root, files) {
  const failures = [];
  for (const file of files) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      const match = ARABIC_DASH.exec(line);
      if (!match) return;
      failures.push(
        `${file}:${index + 1}:${match.index + 1}  an em/en dash sits inside ` +
          'Arabic prose. Arabic uses a comma, a colon or brackets; the dash ' +
          'is the clearest signal that the text was written in English and ' +
          'carried across unchanged (scripts/i18n/lib/validator.ts:29 ' +
          'enforces the same rule on the catalogues).',
      );
    });
  }
  return failures;
}

function main() {
  const root = repoRoot();
  const files = trackedMarkdown(root);
  const failures = [
    ...checkRootRunbook(files),
    ...checkVercel(root, files),
    ...checkArabicDashes(root, files),
  ];

  if (failures.length > 0) {
    console.error(`docs:check FAILED — ${failures.length} problem(s):\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error('');
    process.exit(1);
  }

  console.log(
    `docs:check OK — ${files.length} tracked .md files; no root DEPLOY.md, ` +
      `no Vercel outside ${VERCEL_EXEMPT}, no dash inside Arabic prose.`,
  );
}

main();
