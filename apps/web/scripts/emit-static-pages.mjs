#!/usr/bin/env node
/**
 * Copy the pre-rendered landing and login pages into the static assets, so
 * Workers Static Assets serves them BEFORE the Worker runs.
 *
 * Why: on the Workers Free plan every Worker request has a 10 ms CPU budget,
 * and rendering these pages costs far more, so they failed with Error 1102.
 * Served as assets they cost no Worker CPU at all. OpenNext 1.20.2 copies only
 * BUILD_ID, .next/static and public/ into .open-next/assets; pre-rendered HTML
 * goes to its cache, which the default (dummy) incremental cache never reads.
 * So without this copy even a fully static page renders in the Worker.
 *
 * Runs from apps/web after `opennextjs-cloudflare build` and before
 * `assert-no-baked-secrets.mjs` (so the secret scan covers the HTML), in ci.yml
 * and deploy.yml. Every check fails the build loudly: a route that stopped
 * being static, a missing file, or an asset already in the way.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The pre-rendered routes (app/[locale]/page.tsx and (auth)/login/page.tsx, one per locale). */
const STATIC_ROUTES = ['/ar-EG', '/en', '/ar-EG/login', '/en/login'];

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // apps/web
const manifestPath = join(webRoot, '.next', 'prerender-manifest.json');
const renderedRoot = join(webRoot, '.next', 'server', 'app');
const assetsRoot = join(webRoot, '.open-next', 'assets');

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

const routes = readManifestRoutes();

if (!existsSync(join(assetsRoot, 'index.html'))) {
  bail(`${join(assetsRoot, 'index.html')} is missing: public/index.html is the "/" locale redirector`);
}

for (const route of STATIC_ROUTES) {
  const entry = routes[route];
  if (!entry) bail(`${route} is not pre-rendered (no prerender-manifest entry): did its page stop being static?`);
  if (entry.initialRevalidateSeconds !== false) {
    bail(`${route} is pre-rendered with revalidate ${entry.initialRevalidateSeconds}, not fully static`);
  }
  const source = join(renderedRoot, `${route}.html`);
  if (!existsSync(source)) bail(`${source} is missing`);
  const target = join(assetsRoot, `${route}.html`);
  if (existsSync(target)) bail(`${target} already exists: something else writes this asset`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`copied ${route} ${statSync(target).size}`);
}
