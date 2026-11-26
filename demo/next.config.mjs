// Static build of the browser demo: `npm run build:demo` (see scripts/build-demo.ts).
const basePath = process.env.DEMO_BASE_PATH ?? "/askdocs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // The demo reuses BM25, tokenizing and rank fusion from ../src/lib.
  experimental: { externalDir: true },
};
export default nextConfig;
