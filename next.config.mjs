/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next.js would announce itself in every response.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Security headers for every response. The Content-Security-Policy
        // needs a fresh nonce per page, so src/proxy.ts sets it. HSTS belongs
        // to the reverse proxy that terminates HTTPS (see SECURITY.md).
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
          },
        ],
      },
      {
        // Never serve the service worker from the HTTP cache, or updates
        // would reach users late.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
  // Loaded by Node at runtime instead of bundled: the PostgreSQL Prisma client
  // (generated next to the default SQLite one, see src/lib/db-local.ts) and
  // the Redis client, which only loads when REDIS_URL is set.
  serverExternalPackages: [".prisma/client-postgres", "ioredis"],
  // The browser bundle gets an empty set of translations; the root layout
  // sends the user's language (see src/components/LocaleDictionary.tsx).
  turbopack: {
    resolveAlias: {
      "@/lib/i18n-dicts": { browser: "./src/lib/i18n-dicts.browser.ts" },
    },
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
