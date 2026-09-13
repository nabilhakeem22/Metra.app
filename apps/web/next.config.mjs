import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// A production build with no canonical origin ships silently broken emails: every
// invite and share link is derived from NEXT_PUBLIC_APP_URL, and without it the
// link falls back to whatever host the request arrived on (workers.dev). Fail the
// build instead of discovering it in a client's inbox. CI and deploy both pass it
// in from repo Actions variables.
if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_APP_URL?.trim()) {
  throw new Error(
    'NEXT_PUBLIC_APP_URL must be set for a production build: every emailed link is derived from it (see docs/DEPLOY.md).',
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Linting is run separately (root `npm run lint`) so the build doesn't need an
  // eslint config colocated in apps/web.
  eslint: { ignoreDuringBuilds: true },
  // @metra/db is consumed as TypeScript source from the workspace.
  transpilePackages: ['@metra/db'],
  // Keep native/server-only deps out of the client bundle. PDF rendering now
  // runs on Cloudflare Browser Rendering (the BROWSER binding via
  // @cloudflare/puppeteer), so the old Chromium bundling externals are gone.
  serverExternalPackages: ['postgres'],
};

export default withNextIntl(nextConfig);
