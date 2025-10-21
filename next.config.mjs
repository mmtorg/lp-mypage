/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: "/tr/:path*",
        destination: "https://daily-mna.vercel.app/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
