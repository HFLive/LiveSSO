import type { NextConfig } from "next";

const usesVercelManagedOutput = process.env.VERCEL === "1" || process.env.DEPLOYMENT_MODE === "official";

const nextConfig: NextConfig = {
  agentRules: false,
  output: usesVercelManagedOutput ? undefined : "standalone",
  poweredByHeader: false,
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
