import type { NextConfig } from "next";

// Amplify Hosting compute supports Next.js up to 15. Do not enable streaming,
// Edge runtime routes, on-demand ISR or unstable_after (unsupported on Amplify).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
