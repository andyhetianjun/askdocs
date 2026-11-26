/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp", "pg"],
};
export default nextConfig;
