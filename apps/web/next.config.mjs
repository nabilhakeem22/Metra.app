import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Linting is run separately (root `npm run lint`) so the build doesn't need an
  // eslint config colocated in apps/web.
  eslint: { ignoreDuringBuilds: true },
  // @metra/db is consumed as TypeScript source from the workspace.
  transpilePackages: ['@metra/db'],
  // Keep native/server-only deps out of the client bundle.
  serverExternalPackages: [
    'postgres',
    'puppeteer',
    'puppeteer-core',
    '@sparticuz/chromium',
  ],
  // The proposal PDF/preview embeds .ttf fonts read from disk at runtime. Next's
  // tracer can't follow an fs.readFileSync path, so bundle the fonts into every
  // function that renders a proposal (the PDF route + the proposal pages whose
  // server actions call buildProposalHtml). Both route-group spellings are listed
  // so the include matches regardless of how the route is keyed.
  outputFileTracingIncludes: {
    '/api/pdf/**': ['./src/lib/pdf/fonts/**'],
    '/[locale]/(app)/proposals/**': ['./src/lib/pdf/fonts/**'],
    '/[locale]/proposals/**': ['./src/lib/pdf/fonts/**'],
  },
};

export default withNextIntl(nextConfig);
