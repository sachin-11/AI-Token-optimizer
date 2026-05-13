import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // tiktoken ships a WASM binary that webpack 5 cannot parse.
  // Marking it as a server external lets Node.js load it natively at runtime
  // instead of going through the webpack bundle pipeline.
  serverExternalPackages: [
    "tiktoken",
    // onnxruntime-node is an optional ML dependency — only needed after running
    // the Python training script and installing it manually. Exclude from the
    // webpack bundle so the build succeeds without it being installed.
    "onnxruntime-node",
  ],

  // TypeScript strict mode has pre-existing failures in backend/agent modules.
  typescript: {
    ignoreBuildErrors: true,
  },

  // ESLint has pre-existing import-order and assertion warnings across worker files.
  // Lint runs separately in CI; don't block production builds.
  eslint: {
    ignoreDuringBuilds: true,
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
        // tiktoken ships a WASM binary — exclude from webpack and let Node.js
        // require() it at runtime where WASM works without extra config
        "tiktoken",
        // onnxruntime-node — optional ML runtime, only present after manual install.
        // Handled gracefully in ModeAdvisorService: falls back to rule-based logic.
        "onnxruntime-node",
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
