import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@clawix/shared'],
  // Enable standalone output for Docker production builds
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
};

export default nextConfig;
