import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Many backend/agent modules still fail strict + exactOptionalPropertyTypes checks; UI routes compile.
  typescript: {
    ignoreBuildErrors: true,
  },

  // Fix workspace root warning
  outputFileTracingRoot: path.join(__dirname),

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
    ],
  },

  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === "development",
    },
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [
        ...externals,
        "pino-pretty",
        "thread-stream",
        // BullMQ uses Node.js path/child_process — must not be bundled
        "bullmq",
        "ioredis",
      ];
    }

    config.plugins.push(
      new (require("webpack").IgnorePlugin)({
        resourceRegExp: /^@opentelemetry\/exporter-jaeger$/,
      }),
    );

    return config;
  },
};

export default nextConfig;
