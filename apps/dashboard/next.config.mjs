/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@trailme/shared",
    "@trailme/map-style",
    "@trailme/supabase-client",
    "@trailme/db-types",
  ],
};

export default nextConfig;
