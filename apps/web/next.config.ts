import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Required by apps/web/Dockerfile: emits .next/standalone + apps/web/server.js
  // so the runtime stage can run without the full workspace installed.
  output: 'standalone',
  async headers() {
    return [
      {
        // Service worker updates must never be served stale, or phones
        // keep running old push/caching code after a deploy.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
  async rewrites() {
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${api}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
