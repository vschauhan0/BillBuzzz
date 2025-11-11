// next.config.mjs (ESM)
import { fileURLToPath } from "node:url";
import path from "node:path";

/** recreate __dirname for ESM */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // produce a self-contained standalone server in .next/standalone
  output: "standalone",

  // avoid Next picking a parent folder as workspace root
  outputFileTracingRoot: __dirname,

  // IMPORTANT: make Next emit relative asset URLs for packaged apps
  assetPrefix: "/",

  // keep your existing settings
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },

  // optional: leave basePath empty so Next won't assume a leading slash
  // basePath: '',
};

export default nextConfig;
