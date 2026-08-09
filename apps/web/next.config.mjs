import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Linting is run separately (root `npm run lint`) so the build doesn't need an
  // eslint config colocated in apps/web.
  eslint: { ignoreDuringBuilds: true },
  // @merta/db is consumed as TypeScript source from the workspace.
  transpilePackages: ['@merta/db'],
  // Keep native/server-only deps out of the client bundle.
  serverExternalPackages: [
    'postgres',
    'puppeteer',
    'puppeteer-core',
    '@sparticuz/chromium',
  ],
};

export default withNextIntl(nextConfig);
