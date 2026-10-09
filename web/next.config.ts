import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Сборка для Docker: в образ попадает только нужное для запуска.
  output: "standalone",
};

export default nextConfig;
