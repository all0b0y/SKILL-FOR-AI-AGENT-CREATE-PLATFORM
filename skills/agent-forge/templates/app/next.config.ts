import type { NextConfig } from 'next';

// pg and pg-boss use Node APIs; keep them out of the bundle.
const config: NextConfig = {
  serverExternalPackages: ['pg', 'pg-boss'],
  typedRoutes: true,
};

export default config;
