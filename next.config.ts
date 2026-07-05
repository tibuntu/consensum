import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-better-sqlite3", "better-sqlite3", "@prisma/adapter-pg", "pg"],
  async redirects() {
    // The app used to live under /app; keep old bookmarks and emailed links working.
    return [
      { source: "/app", destination: "/", permanent: true },
      { source: "/app/:path*", destination: "/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
