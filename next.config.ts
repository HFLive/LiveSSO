import type { NextConfig } from "next";
import { resolveStaticAssetConfig } from "./scripts/static-assets-config";

const usesVercelManagedOutput = process.env.VERCEL === "1" || process.env.DEPLOYMENT_MODE === "official";
const { assetPrefix } = resolveStaticAssetConfig();

const nextConfig: NextConfig = {
  agentRules: false,
  output: usesVercelManagedOutput ? undefined : "standalone",
  poweredByHeader: false,
  assetPrefix,
  experimental: {
    typedEnv: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
