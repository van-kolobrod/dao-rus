import type { NextConfig } from "next";

export function allowedDevOriginsFromBaseUrl(value: string | undefined) {
  if (!value) return [];

  try {
    return [new URL(value).hostname];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: allowedDevOriginsFromBaseUrl(process.env.APP_BASE_URL),
};

export default nextConfig;
