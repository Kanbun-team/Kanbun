/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
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
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
