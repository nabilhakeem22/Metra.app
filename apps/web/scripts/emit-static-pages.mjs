#!/usr/bin/env node
/**
 * Copy the pre-rendered landing and login pages, robots.txt and sitemap.xml
 * into the static assets, so Workers Static Assets serves them BEFORE the
 * Worker runs; then add the search-engine verification tags to "/".
 *
 * Why: on the Workers Free plan every Worker request has a 10 ms CPU budget,
 * and rendering these pages costs far more, so they failed with Error 1102.
 * Served as assets they cost no Worker CPU at all. A robots.txt that answers
 * 1102 or 5xx makes Google pause crawling the whole site. OpenNext 1.20.2
 * copies only BUILD_ID, .next/static and public/ into .open-next/assets;
 * pre-rendered output goes to its cache, which the default (dummy) incremental
 * cache never reads. So without this copy even a fully static page renders in
 * the Worker.
 *
 * Runs from apps/web after `opennextjs-cloudflare build` and before
 * `assert-no-baked-secrets.mjs` (so the secret scan covers the HTML), in ci.yml
 * and deploy.yml. Every check fails the build loudly: a route that stopped
 * being static, a missing file, an asset already in the way, or a malformed
 * verification token.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The pre-rendered routes (app/[locale]/page.tsx and (auth)/login/page.tsx, one per locale). */
const STATIC_ROUTES = ['/ar-EG', '/en', '/ar-EG/login', '/en/login'];

/** Pre-rendered route handlers served as assets: [route, file under .next/server/app]. */
const STATIC_FILES = [
  ['/robots.txt', 'robots.txt.body'],
  ['/sitemap.xml', 'sitemap.xml.body'],
];

/** Equal to VERIFICATION_TOKEN in src/lib/seo/site-verification.ts (src/test/verification-regex.test.ts). */
const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{10,100}$/;

/** [env var, meta name] of each search engine's ownership tag. */
const VERIFICATION_TAGS = [
  ['NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION', 'google-site-verification'],
  ['NEXT_PUBLIC_BING_SITE_VERIFICATION', 'msvalidate.01'],
];

/** The tags go right after this, in the "/" redirector page. */
const CHARSET_MARKER = '<meta charset="utf-8">';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // apps/web
const manifestPath = join(webRoot, '.next', 'prerender-manifest.json');
const renderedRoot = join(webRoot, '.next', 'server', 'app');
const assetsRoot = join(webRoot, '.open-next', 'assets');
const rootPagePath = join(assetsRoot, 'index.html');

/** Loud on purpose: a check that cannot find its input must fail, not pass. */
function bail(message) {
  console.error(`emit-static-pages: ${message}`);
  process.exit(1);
}

function readManifestRoutes() {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')).routes ?? {};
  } catch (cause) {
    return bail(`cannot read ${manifestPath} (run after the OpenNext build): ${String(cause)}`);
  }
}

/** Copy one fully static pre-rendered output to its asset path, refusing anything less. */
function copyPrerendered(routes, route, source, target) {
  const entry = routes[route];
  if (!entry) bail(`${route} is not pre-rendered (no prerender-manifest entry): did it stop being static?`);
  if (entry.initialRevalidateSeconds !== false) {
    bail(`${route} is pre-rendered with revalidate ${entry.initialRevalidateSeconds}, not fully static`);
  }
  if (!existsSync(source)) bail(`${source} is missing`);
  if (existsSync(target)) bail(`${target} already exists: something else writes this asset`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`copied ${route} ${statSync(target).size}`);
}

/** The verification meta tags the env asks for; bails on a malformed token. */
function verificationTags() {
  return VERIFICATION_TAGS.flatMap(([variable, name]) => {
    const token = process.env[variable]?.trim();
    if (!token) return [];
    if (!VERIFICATION_TOKEN.test(token)) bail(`${variable} is not a valid site-verification token`);
    return [`<meta name="${name}" content="${token}">`];
  });
}

/** Search Console and Bing check "/" for their tag: add the configured ones to the redirector page. */
function injectVerificationTags(tags) {
  if (tags.length === 0) return;
  const html = readFileSync(rootPagePath, 'utf8');
  if (html.split(CHARSET_MARKER).length !== 2) bail(`${rootPagePath} must hold ${CHARSET_MARKER} exactly once`);
  writeFileSync(rootPagePath, html.replace(CHARSET_MARKER, `${CHARSET_MARKER}\n${tags.join('\n')}`));
  console.log(`added ${tags.length} verification tag(s) to /`);
}

// Tokens first, so a malformed one fails before anything is copied.
const tags = verificationTags();
const routes = readManifestRoutes();

if (!existsSync(rootPagePath)) {
  bail(`${rootPagePath} is missing: public/index.html is the "/" locale redirector`);
}

for (const route of STATIC_ROUTES) {
  copyPrerendered(routes, route, join(renderedRoot, `${route}.html`), join(assetsRoot, `${route}.html`));
}
for (const [route, file] of STATIC_FILES) {
  copyPrerendered(routes, route, join(renderedRoot, file), join(assetsRoot, route.slice(1)));
}
injectVerificationTags(tags);
