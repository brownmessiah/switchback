import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { serverActionAllowedOrigins } from "./lib/config/origins";

const withNextIntl = createNextIntlPlugin({
  requestConfig: "./lib/i18n/request.ts",
});

// ADR-0019: behind the External LB, Server Actions must trust the prod host or
// the Origin/Host CSRF check rejects them. Derived at build time from
// NEXT_PUBLIC_APP_URL (+ optional comma-separated AUTH_TRUSTED_ORIGINS). The old
// ngrok dev hacks are removed — the demo runs on Cloud Run behind the LB.
const allowedOrigins = serverActionAllowedOrigins(
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.AUTH_TRUSTED_ORIGINS,
);

const nextConfig: NextConfig = {
  // Self-contained server output for the Cloud Run container (ADR-0019).
  output: "standalone",
  // launch-readiness/04: the `prelaunch` Playwright project runs a SECOND
  // `next dev` instance (port 3100, isolated DB) from this SAME working
  // directory so it can assert the pre-launch home composition against an
  // empty database. Turbopack's dev build cache lives under
  // `<distDir>/dev` — two concurrent `next dev` processes writing the same
  // `.next/dev` would race and could corrupt each other's cache and take
  // down the PRIMARY (port 3000) dev server every other E2E project
  // depends on. NEXT_DIST_DIR gives the second instance a private build
  // directory; unset everywhere else (local dev, `next build`, Cloud Run)
  // this is a no-op — distDir defaults to ".next".
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      allowedOrigins,
    },
  },
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
