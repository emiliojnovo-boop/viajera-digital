/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['i.ytimg.com', 'img.youtube.com'],
  },
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
  },
  experimental: {
    serverActions: {
      // Allow up to 26MB for audio file uploads
      // Groq's limit is 25MB, we use 26MB to account for multipart overhead
      bodySizeLimit: '26mb',
    },
  },
  // Increase timeout for long-running transcription operations
  // Important: Vercel has a 60s timeout on Pro plan, 10s on Hobby
  api: {
    responseLimit: '26mb',
  },
};

module.exports = nextConfig;
