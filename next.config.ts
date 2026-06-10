import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin({
  requestConfig: "./lib/i18n/request.ts",
});

const nextConfig: NextConfig = {
  // Local-demo only: allow the ngrok tunnel host to reach the dev server
  // (Next 16 blocks cross-origin dev requests otherwise). Safe to remove.
  allowedDevOrigins: ['2e99352b354d.ngrok.app', '.ngrok.app'],
  experimental: {
    // Local-demo only: `next start` sits behind the ngrok tunnel, so every
    // Server Action POST arrives with Origin=<tunnel host> but Host=localhost.
    // Next 16's Server Action CSRF check rejects that mismatch ("failed to
    // forward action response" → the post-sign-in redirect action throws and
    // the UI appears to do nothing). Trusting the tunnel origin fixes ALL
    // server actions behind the proxy (sign-in redirect, cancel, checkout…).
    // Safe to remove alongside allowedDevOrigins. (Wildcards are supported.)
    serverActions: {
      allowedOrigins: ['2e99352b354d.ngrok.app', '*.ngrok.app', '*.ngrok-free.app'],
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
