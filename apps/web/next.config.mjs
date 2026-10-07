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
  // Server actions refuse a body over 1 MB by default. The proposal builder saves
  // the whole draft in one action (autosave, and Send's save first), and a
  // 2,000-line BOQ with full bilingual descriptions encodes past 1 MB, which would
  // leave it unable to save or send at all. 4 MB holds the 2,000-line cap with
  // descriptions of about 500 characters in both languages. Workers accept request
  // bodies up to 100 MB on every plan, so this is Next's limit, not the
  // platform's. The builder checks the size first and says so past ~90% of it
  // (draft-size.ts, SERVER_ACTION_BODY_LIMIT_MB, kept equal by its test).
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default withNextIntl(nextConfig);
