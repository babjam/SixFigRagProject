import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb', // 👈 Increases limit from default (1MB/4MB) to 100MB
    },
  },
};

export default nextConfig;