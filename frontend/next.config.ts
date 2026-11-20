import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O motor de dados 3D vive em ../shared/dice3d e é usado também pelo app mobile.
  turbopack: { root: path.join(import.meta.dirname, "..") },
};

export default nextConfig;
