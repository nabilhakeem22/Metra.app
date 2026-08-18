import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
