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
        source: "/so/tr/:path*",
        destination: "https://myanmar-news-alert.vercel.app/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
