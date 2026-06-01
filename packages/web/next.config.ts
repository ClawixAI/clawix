import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@clawix/shared'],
  experimental: {
    // Rewrite the unified `radix-ui` barrel into direct deep imports so only
    // the primitives a page uses get compiled. The barrel is imported by ~19
    // ui/ components, so without this every route's first dev compile drags in
    // all ~30 Radix primitives. (lucide-react and recharts are already in
    // Next's default optimizePackageImports list; `radix-ui` is not.)
    optimizePackageImports: ['radix-ui'],
  },
  // Enable standalone output for Docker production builds
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
};

export default nextConfig;
