import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin({
  requestConfig: "./lib/i18n/request.ts",
});

const nextConfig: NextConfig = {
  images: {
    // Hosts that `media_assets.url` can point to (parity-catchup/02):
    //  - images.unsplash.com — seed/demo catalog imagery + stock fallbacks.
    //  - storage.googleapis.com — production GCS uploads (lib/storage/gcs.ts).
    // Local dev uploads are served from `/uploads/*` (same-origin, no pattern).
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/sitemap-:locale.xml',
        destination: '/api/sitemap/:locale',
      },
    ]
  },
};

export default withNextIntl(nextConfig);
